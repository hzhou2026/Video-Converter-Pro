const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const path = require("node:path");
const fs = require("node:fs").promises;
const fsSync = require("node:fs");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("node:events");
const { exec } = require("node:child_process");
const util = require("node:util");
const execPromise = util.promisify(exec);
const crypto = require("node:crypto");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const helmet = require("helmet");
const winston = require("winston");
const Queue = require("bull");
const Redis = require("ioredis");
const socketIO = require("socket.io");
const http = require("node:http");
const {
  validateConversionCompatibility,
  resolveOutputFormat,
  applyOutputFormat,
  PRESET_FORMAT_COMPATIBILITY,
  FORMAT_CODEC_COMPATIBILITY,
} = require('./compatibilidad.js');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"]
  }
});

// ===================== CONFIGURACIÓN =====================

const config = {
  port: process.env.PORT || 3000,
  maxFileSize: Number.parseInt(process.env.MAX_FILE_SIZE) || 2000 * 1024 * 1024, // 2GB
  maxConcurrentJobs: Number.parseInt(process.env.MAX_CONCURRENT_JOBS) || 3,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  storageType: process.env.STORAGE_TYPE || 'local', // 'local' o 's3'
  s3Bucket: process.env.S3_BUCKET,
  cleanupInterval: Number.parseInt(process.env.CLEANUP_INTERVAL) || 60000, // 1 minuto
  fileRetentionTime: Number.parseInt(process.env.FILE_RETENTION) || 10800000, // 3 horas
};

// ===================== CONFIGURACIÓN DE LIMPIEZA AGRESIVA =====================

const cleanupConfig = {
  deleteInputAfterProcessing: true,
  deleteOutputAfterDownload: true,
  maxDownloads: 1,
  failedJobRetention: 600000,
  completedJobRetention: 1800000,
  undownloadedJobRetention: 7200000
};

// ===================== TRACKING =====================

const downloadTracker = new Map();
const activeFFmpegProcesses = new Map();

// Inicializar tracking de descarga
function initDownloadTracking(jobId) {
  if (!downloadTracker.has(jobId)) {
    downloadTracker.set(jobId, {
      count: 0,
      downloadingClients: new Set(),
      lastDownloadedAt: null,
      fullyDownloaded: false
    });
  }
  return downloadTracker.get(jobId);
}

// Marcar cliente como descargando
function startDownload(jobId, clientId) {
  const tracking = initDownloadTracking(jobId);
  tracking.downloadingClients.add(clientId);
  logger.info(`Client ${clientId} started downloading job ${jobId}`);
}

// Marcar descarga como completa
function finishDownload(jobId, clientId, success = true) {
  const tracking = downloadTracker.get(jobId);
  if (!tracking) return;

  tracking.downloadingClients.delete(clientId);

  if (success) {
    tracking.count++;
    tracking.lastDownloadedAt = Date.now();
    tracking.fullyDownloaded = true;
    logger.info(`Client ${clientId} finished downloading job ${jobId} (total downloads: ${tracking.count})`);
  } else {
    logger.warn(`Client ${clientId} failed to download job ${jobId}`);
  }
}

// Verificar si un archivo está siendo descargado
function isBeingDownloaded(jobId) {
  const tracking = downloadTracker.get(jobId);
  return tracking && tracking.downloadingClients.size > 0;
}

// ===================== TRACKING DE USUARIOS Y SESIONES =====================

// Mapear socket.id
const socketToUser = new Map();
const userToSockets = new Map();
const userJobs = new Map();

// Asociar un socket con un usuario
function associateSocketWithUser(socketId, userId) {
  socketToUser.set(socketId, userId);

  if (!userToSockets.has(userId)) {
    userToSockets.set(userId, new Set());
  }
  userToSockets.get(userId).add(socketId);

  logger.info(`Socket ${socketId} associated with user ${userId}`);
}

// Desasociar un socket de un usuario
function disassociateSocket(socketId) {
  const userId = socketToUser.get(socketId);
  if (!userId) return null;

  socketToUser.delete(socketId);

  const userSockets = userToSockets.get(userId);
  if (userSockets) {
    userSockets.delete(socketId);
    if (userSockets.size === 0) {
      userToSockets.delete(userId);
      logger.info(`User ${userId} has no more connected sockets`);
      return userId; // Usuario completamente desconectado
    }
  }

  return null; // Usuario aún tiene otras conexiones
}

// Asociar un job con un usuario
function associateJobWithUser(jobId, userId) {
  if (!userJobs.has(userId)) {
    userJobs.set(userId, new Set());
  }
  userJobs.get(userId).add(jobId);
  logger.info(`Job ${jobId} associated with user ${userId}`);
}

// Obtener todos los jobs de un usuario
function getUserJobs(userId) {
  return Array.from(userJobs.get(userId) || []);
}

// Verificar si un usuario está conectado
function isUserConnected(userId) {
  const sockets = userToSockets.get(userId);
  return sockets && sockets.size > 0;
}

// ===================== LOGGING =====================

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// ===================== MIDDLEWARE =====================

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Limitador de tasa
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // limite cada IP a 100 requests por ventana
  message: 'Demasiadas solicitudes de esta IP, por favor intente de nuevo más tarde.'
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 20, // limite cada IP a 20 uploads por hora
  message: 'Límite de carga excedido, por favor intente de nuevo más tarde.'
});

app.use('/api/', limiter);
app.use('/api/convert', uploadLimiter);
app.use('/api/batch-convert', uploadLimiter);

// ===================== DIRECTORIOS =====================

const dirs = {
  uploads: process.env.UPLOADS_DIR || "uploads",
  outputs: process.env.OUTPUTS_DIR || "outputs",
};

// Crear directorios si no existen
for (const dir of Object.values(dirs)) {
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
}

// ===================== GESTIÓN DE TRABAJOS =====================
class JobManager {
  constructor(socketIO) {
    this.jobs = new Map();
    this.bullJobIds = new Map();
    this.emitter = new EventEmitter();
    this.io = socketIO;
  }

  createJob(data) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      ...data,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      metadata: {}
    };
    this.jobs.set(jobId, job);
    this.emitter.emit('job:created', job);
    return job;
  }

  setBullJobId(jobId, bullJobId) {
    this.bullJobIds.set(jobId, bullJobId);
  }

  getBullJobId(jobId) {
    return this.bullJobIds.get(jobId);
  }

  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      this.emitter.emit('job:updated', job);
      this.io.to(jobId).emit('job:update', job);
    }
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  getAllJobs(userId = null) {
    const jobs = Array.from(this.jobs.values());
    if (userId) {
      return jobs.filter(job => job.userId === userId);
    }
    return jobs;
  }

  deleteJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      this.jobs.delete(jobId);
      this.bullJobIds.delete(jobId);
      this.emitter.emit('job:deleted', job);
    }
    return job;
  }
}

const jobManager = new JobManager(io);

// ===================== REDIS & QUEUE =====================

const redis = new Redis(config.redisUrl);
const videoQueue = new Queue('video-conversion', config.redisUrl);
const subscriber = new Redis(config.redisUrl);

subscriber.on('message', async (channel, message) => {
  if (channel === 'job:progress') {
    const data = JSON.parse(message);

    // jobManager local
    const job = jobManager.getJob(data.jobId);
    if (job) {
      jobManager.updateJob(data.jobId, {
        status: 'processing',
        progress: data.progress,
        currentTime: data.currentTime,
        fps: data.fps,
        speed: data.speed
      });
    }

    // Emitir a través de Socket.IO a TODOS los clientes suscritos
    io.to(data.jobId).emit('job:update', {
      id: data.jobId,
      jobId: data.jobId,
      status: 'processing',
      progress: data.progress,
      currentTime: data.currentTime,
      fps: data.fps,
      speed: data.speed
    });
  }

  // Escuchar evento de completado
  if (channel === 'job:completed') {
    const data = JSON.parse(message);
    const job = jobManager.getJob(data.jobId);
    if (job) {
      jobManager.updateJob(data.jobId, {
        status: 'completed',
        progress: 100,
        result: data.result,
        completedAt: Date.now()
      });

      io.to(data.jobId).emit('job:update', {
        id: data.jobId,
        jobId: data.jobId,
        status: 'completed',
        progress: 100,
        result: data.result
      });
    }
  }

  // Escuchar evento de error
  if (channel === 'job:failed') {
    const data = JSON.parse(message);
    const job = jobManager.getJob(data.jobId);
    if (job) {
      jobManager.updateJob(data.jobId, {
        status: 'failed',
        progress: 0,
        error: data.error
      });

      io.to(data.jobId).emit('job:update', {
        id: data.jobId,
        jobId: data.jobId,
        status: 'failed',
        progress: 0,
        error: data.error
      });
    }
  }
});

// SUSCRIBIRSE A TODOS LOS CANALES NECESARIOS
subscriber.subscribe('job:progress', (err, count) => {
  if (err) {
    logger.error('Failed to subscribe to job:progress', err);
  } else {
    logger.info('Subscribed to job:progress channel');
  }
});

subscriber.subscribe('job:completed', (err, count) => {
  if (err) {
    logger.error('Failed to subscribe to job:completed', err);
  } else {
    logger.info('Subscribed to job:completed channel');
  }
});

subscriber.subscribe('job:failed', (err, count) => {
  if (err) {
    logger.error('Failed to subscribe to job:failed', err);
  } else {
    logger.info('Subscribed to job:failed channel');
  }
});

// Procesar trabajos en la cola
videoQueue.process(config.maxConcurrentJobs, async (job) => {
  const { jobId, inputPath, outputPath, options } = job.data;
  logger.info(`Processing job ${jobId}`);

  try {
    const result = await convertVideoWithProgress(jobId, inputPath, outputPath, options, job);
    return result;
  } catch (error) {
    logger.error(`Job ${jobId} failed:`, error);
    throw error;
  }
});

// ===================== PRESETS =====================

const PRESETS = {
  // ========== CODECS MODERNOS (H.264/H.265/AV1/VP9) ==========

  'h264-ultra': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 15,
    preset: 'veryslow',
    audioBitrate: '320k',
    description: 'H.264 Ultra - Máxima calidad',
    allowCustomOptions: true
  },
  'h264-high': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 18,
    preset: 'slow',
    audioBitrate: '256k',
    description: 'H.264 Alta Calidad',
    allowCustomOptions: true
  },
  'h264-normal': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '192k',
    description: 'H.264 Calidad Normal - Balance ideal',
    allowCustomOptions: true
  },
  'h264-fast': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 28,
    preset: 'fast',
    audioBitrate: '128k',
    description: 'H.264 Rápido - Menor calidad pero más rápido',
    allowCustomOptions: true
  },

  'h265-high': {
    videoCodec: 'libx265',
    audioCodec: 'aac',
    crf: 24,
    preset: 'medium',
    audioBitrate: '192k',
    description: 'H.265/HEVC Alta Calidad - 50% menos tamaño que H.264',
    allowCustomOptions: true
  },
  'h265-normal': {
    videoCodec: 'libx265',
    audioCodec: 'aac',
    crf: 28,
    preset: 'medium',
    audioBitrate: '128k',
    description: 'H.265/HEVC Normal - Mejor compresión que H.264',
    allowCustomOptions: true
  },

  'av1-high': {
    videoCodec: 'libaom-av1',
    audioCodec: 'libopus',
    crf: 28,
    preset: 6,
    audioBitrate: '192k',
    description: 'AV1 Alta Calidad - Mejor compresión moderna',
    allowCustomOptions: true
  },
  'av1-normal': {
    videoCodec: 'libaom-av1',
    audioCodec: 'libopus',
    crf: 30,
    preset: 6,
    audioBitrate: '128k',
    description: 'AV1 Normal - Codec del futuro',
    allowCustomOptions: true
  },

  'vp9-web': {
    videoCodec: 'libvpx-vp9',
    audioCodec: 'libopus',
    crf: 31,
    preset: 'good',
    audioBitrate: '128k',
    description: 'VP9 para Web - Compatible con navegadores',
    allowCustomOptions: true
  },

  'webm-vp9': {
    videoCodec: 'libvpx-vp9',
    audioCodec: 'libopus',
    crf: 31,
    preset: 'good',
    audioBitrate: '128k',
    outputFormat: 'webm',
    description: 'WebM VP9 - Formato web moderno',
    extraOptions: [
      '-b:v', '0',
      '-tile-columns', '2',
      '-threads', '4',
      '-row-mt', '1'
    ],
    allowCustomOptions: true
  },
  'webm-vp8-fast': {
    videoCodec: 'libvpx',
    audioCodec: 'libvorbis',
    audioBitrate: '128k',
    outputFormat: 'webm',
    description: 'WebM VP8 Rápido - Conversión veloz',
    extraOptions: [
      '-b:v', '1M',
      '-quality', 'good',
      '-cpu-used', '2'
    ],
    allowCustomOptions: true
  },

  // ========== STREAMING & WEB ==========

  'web-streaming': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    description: 'Streaming Web Optimizado',
    extraOptions: [
      '-movflags', '+faststart',
      '-profile:v', 'main',
      '-level', '4.0',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0'
    ],
    allowCustomOptions: true
  },
  'hls-streaming': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    description: 'HLS Streaming Adaptativo',
    outputFormat: 'hls',
    extraOptions: [
      '-hls_time', '10',
      '-hls_list_size', '0',
      '-hls_segment_filename', 'segment_%03d.ts'
    ],
    allowCustomOptions: true
  },

  'mobile-optimized': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 28,
    preset: 'fast',
    audioBitrate: '96k',
    resolution: '720x?',
    description: 'Optimizado para Móviles',
    extraOptions: ['-profile:v', 'baseline', '-level', '3.0'],
    allowCustomOptions: true
  },

  'gif-animated': {
    description: 'GIF Animado - Para clips cortos',
    outputFormat: 'gif',
    fps: 10,
    resolution: '480x?',
    extraOptions: [
      '-vf', 'fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse'
    ],
    allowCustomOptions: true
  },

  // ========== REDES SOCIALES ==========

  'youtube-4k': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 18,
    preset: 'slow',
    audioBitrate: '256k',
    resolution: '3840x2160',
    fps: 30,
    description: 'YouTube 4K (3840x2160)',
    extraOptions: ['-movflags', '+faststart', '-pix_fmt', 'yuv420p'],
    allowCustomOptions: true
  },
  'youtube-1080p': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '192k',
    resolution: '1920x1080',
    fps: 30,
    description: 'YouTube 1080p (Full HD)',
    extraOptions: ['-movflags', '+faststart', '-pix_fmt', 'yuv420p'],
    allowCustomOptions: true
  },

  'instagram-post': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    resolution: '1080x1080',
    fps: 30,
    maxDuration: 60,
    description: 'Instagram Post (1:1 cuadrado)',
    extraOptions: ['-movflags', '+faststart'],
    allowCustomOptions: true
  },
  'instagram-reel': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    resolution: '1080x1920',
    fps: 30,
    maxDuration: 90,
    description: 'Instagram Reel (9:16 vertical)',
    extraOptions: ['-movflags', '+faststart'],
    allowCustomOptions: true
  },

  'tiktok-video': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    resolution: '1080x1920',
    fps: 30,
    maxDuration: 180,
    description: 'TikTok (9:16 vertical)',
    extraOptions: ['-movflags', '+faststart'],
    allowCustomOptions: true
  },

  'twitter-video': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 25,
    preset: 'medium',
    audioBitrate: '128k',
    maxSize: '512MB',
    maxDuration: 140,
    description: 'Twitter/X (límite 512MB)',
    extraOptions: ['-movflags', '+faststart'],
    allowCustomOptions: true
  },

  // ========== LOSSLESS & EDICIÓN PROFESIONAL ==========

  'prores-hq': {
    videoCodec: 'prores_ks',
    audioCodec: 'pcm_s16le',
    description: 'ProRes 422 HQ - Producción profesional',
    outputFormat: 'mov',
    extraOptions: [
      '-profile:v', '3',
      '-pix_fmt', 'yuv422p10le',
      '-vendor', 'apl0'
    ],
    allowCustomOptions: false
  },
  'prores-standard': {
    videoCodec: 'prores_ks',
    audioCodec: 'pcm_s16le',
    description: 'ProRes 422 - Estándar profesional',
    outputFormat: 'mov',
    extraOptions: [
      '-profile:v', '2',
      '-pix_fmt', 'yuv422p10le'
    ],
    allowCustomOptions: false
  },
  'prores-lt': {
    videoCodec: 'prores_ks',
    audioCodec: 'pcm_s16le',
    description: 'ProRes LT - Edición ligera',
    outputFormat: 'mov',
    extraOptions: [
      '-profile:v', '1',
      '-pix_fmt', 'yuv422p10le'
    ],
    allowCustomOptions: false
  },
  'prores-proxy': {
    videoCodec: 'prores_ks',
    audioCodec: 'pcm_s16le',
    description: 'ProRes Proxy - Edición offline',
    outputFormat: 'mov',
    extraOptions: [
      '-profile:v', '0',
      '-pix_fmt', 'yuv422p10le'
    ],
    allowCustomOptions: false
  },

  'avi-ffv1-lossless': {
    videoCodec: 'ffv1',
    audioCodec: 'pcm_s16le',
    description: 'FFV1 Lossless - Archivo profesional',
    outputFormat: 'avi',
    extraOptions: [
      '-level', '3',
      '-coder', '1',
      '-context', '1',
      '-g', '1',
      '-slices', '24',
      '-slicecrc', '1'
    ],
    allowCustomOptions: false
  },
  'avi-huffyuv-lossless': {
    videoCodec: 'huffyuv',
    audioCodec: 'pcm_s16le',
    description: 'HuffYUV Lossless - ~50% tamaño raw',
    outputFormat: 'avi',
    extraOptions: [
      '-pix_fmt', 'yuv422p',
      '-pred', 'left'
    ],
    allowCustomOptions: false
  },
  'avi-utvideo-lossless': {
    videoCodec: 'utvideo',
    audioCodec: 'pcm_s16le',
    description: 'UT Video Lossless - Rápido para edición',
    outputFormat: 'avi',
    extraOptions: [
      '-pix_fmt', 'yuv422p',
      '-pred', 'median'
    ],
    allowCustomOptions: false
  },

  'avi-mjpeg-high': {
    videoCodec: 'mjpeg',
    audioCodec: 'pcm_s16le',
    description: 'MJPEG Alta Calidad - Para edición',
    outputFormat: 'avi',
    extraOptions: [
      '-q:v', '2',
      '-pix_fmt', 'yuvj422p',
      '-huffman', 'optimal'
    ],
    allowCustomOptions: false
  },
  'avi-mjpeg-normal': {
    videoCodec: 'mjpeg',
    audioCodec: 'pcm_s16le',
    description: 'MJPEG Normal - Balance tamaño/calidad',
    outputFormat: 'avi',
    extraOptions: [
      '-q:v', '5',
      '-pix_fmt', 'yuvj420p'
    ],
    allowCustomOptions: false
  },

  'avi-dv-pal': {
    videoCodec: 'dvvideo',
    audioCodec: 'pcm_s16le',
    description: 'DV PAL (720x576) - Edición profesional',
    outputFormat: 'avi',
    resolution: '720x576',
    fps: 25,
    extraOptions: [
      '-pix_fmt', 'yuv420p'
    ],
    allowCustomOptions: false
  },
  'avi-dv-ntsc': {
    videoCodec: 'dvvideo',
    audioCodec: 'pcm_s16le',
    description: 'DV NTSC (720x480) - Edición profesional',
    outputFormat: 'avi',
    resolution: '720x480',
    fps: 30,
    extraOptions: [
      '-pix_fmt', 'yuv420p'
    ],
    allowCustomOptions: false
  },

  // ========== SIN COMPRESIÓN (ARCHIVOS MUY GRANDES) ==========

  'avi-raw-uncompressed': {
    videoCodec: 'rawvideo',
    audioCodec: 'pcm_s16le',
    description: 'RAW Sin Comprimir - ¡Archivos ENORMES!',
    outputFormat: 'avi',
    maxDuration: 60,
    extraOptions: [
      '-pix_fmt', 'yuv420p',
      '-vtag', 'I420'
    ],
    allowCustomOptions: false
  },
  'avi-raw-rgb': {
    videoCodec: 'rawvideo',
    audioCodec: 'pcm_s16le',
    description: 'RAW RGB24 - ¡Archivos MUY GRANDES!',
    outputFormat: 'avi',
    maxDuration: 60,
    extraOptions: [
      '-pix_fmt', 'rgb24',
      '-vtag', 'DIB '
    ],
    allowCustomOptions: false
  }
};

// ===================== MULTER CONFIGURACIÓN =====================

const storage = multer.diskStorage({
  destination: dirs.uploads,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: config.maxFileSize
  },
  fileFilter: (req, file, cb) => {
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.hevc', '.h265',
      '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.ogv',
      '.mts', '.m2ts', '.ts', '.vob', '.mpg', '.mpeg'];
    const audioExtensions = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      videoExtensions.includes(fileExtension) ||
      audioExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Only video and audio files are allowed'), false);
    }
  }
});

// ===================== FUNCIONES AUXILIARES =====================

// Calcular hash de archivos
const calculateFileHash = async (filePath) => {
  const fileBuffer = await fs.readFile(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
};

// Información detallada del archivo multimedia
const getMediaInfo = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(new Error('Failed to retrieve media info'));
      } else {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
        const subtitleStream = metadata.streams.find(s => s.codec_type === 'subtitle');

        resolve({
          duration: metadata.format.duration,
          size: metadata.format.size,
          bitrate: metadata.format.bit_rate,
          format: metadata.format.format_name,
          video: videoStream ? {
            codec: videoStream.codec_name,
            codecLong: videoStream.codec_long_name,
            width: videoStream.width,
            height: videoStream.height,
            aspectRatio: videoStream.display_aspect_ratio,
            fps: eval(videoStream.r_frame_rate),
            bitrate: videoStream.bit_rate,
            pixelFormat: videoStream.pix_fmt,
            colorSpace: videoStream.color_space,
            profile: videoStream.profile
          } : null,
          audio: audioStream ? {
            codec: audioStream.codec_name,
            codecLong: audioStream.codec_long_name,
            channels: audioStream.channels,
            channelLayout: audioStream.channel_layout,
            sampleRate: audioStream.sample_rate,
            bitrate: audioStream.bit_rate,
            bitDepth: audioStream.bits_per_sample
          } : null,
          subtitle: subtitleStream ? {
            codec: subtitleStream.codec_name,
            language: subtitleStream.tags?.language
          } : null,
          metadata: metadata.format.tags || {}
        });
      }
    });
  });
};

// Formatear tamaño de archivo
const formatSize = (bytes) => {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
};

const formatDuration = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  let result;
  if (h > 0) {
    result = `${h}h ${m}m ${s}s`;
  } else if (m > 0) {
    result = `${m}m ${s}s`;
  } else {
    result = `${s}s`;
  }
  return result;
};

// ===================== FUNCIONES DE CONVERSIÓN =====================

function buildVideoFilters({ speed, denoise, stabilize, crop, rotate, flip, subtitles }) {
  const videoFilters = [
    ...getDenoiseFilter(denoise),
    ...getStabilizeFilter(stabilize),
    ...getCropFilter(crop),
    ...getRotateFilter(rotate),
    ...getFlipFilter(flip),
    ...getSpeedFilter(speed),
    ...getSubtitlesFilter(subtitles)
  ];
  return videoFilters;
}

function getDenoiseFilter(denoise) {
  return denoise ? ['hqdn3d=4:3:6:4.5'] : [];
}

function getStabilizeFilter(stabilize) {
  return stabilize ? ['deshake'] : [];
}

function getCropFilter(crop) {
  if (!crop) return [];
  if (/^\d+:\d+:\d+:\d+$/.test(crop)) {
    return [`crop=${crop}`];
  } else {
    logger.warn(`Invalid crop format: ${crop}, skipping`);
    return [];
  }
}

function getRotateFilter(rotate) {
  if (!rotate || rotate === 0) return [];
  const normalizedRotate = ((rotate % 360) + 360) % 360;
  if (normalizedRotate === 90) {
    return ['transpose=1'];
  } else if (normalizedRotate === 180) {
    return ['transpose=1,transpose=1'];
  } else if (normalizedRotate === 270) {
    return ['transpose=2'];
  } else {
    const radians = (normalizedRotate * Math.PI / 180).toFixed(4);
    return [`rotate=${radians}:fillcolor=black:ow='hypot(iw,ih)':oh=ow`];
  }
}

function getFlipFilter(flip) {
  if (flip === 'horizontal') {
    return ['hflip'];
  } else if (flip === 'vertical') {
    return ['vflip'];
  } else if (flip === 'both') {
    return ['hflip,vflip'];
  }
  return [];
}

function getSpeedFilter(speed) {
  if (speed && speed !== 1 && speed !== '1') {
    const speedNum = Number.parseFloat(speed);
    if (!Number.isNaN(speedNum) && speedNum > 0) {
      return [`setpts=${(1 / speedNum).toFixed(4)}*PTS`];
    }
  }
  return [];
}

function getSubtitlesFilter(subtitles) {
  if (subtitles && fsSync.existsSync(subtitles)) {
    const filterArg = String.raw`subtitles='${subtitles}'`;
    return [filterArg];
  }
  return [];
}

function buildAudioFilters({ normalizeAudio, speed }) {
  const audioFilters = [];

  // Normalización de audio (aplicar primero)
  if (normalizeAudio) {
    audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }

  // Velocidad para audio (debe coincidir con la velocidad del video)
  if (speed && speed !== 1 && speed !== '1') {
    const speedNum = Number.parseFloat(speed);
    if (!Number.isNaN(speedNum) && speedNum > 0) {
      const atempoFilters = buildAtempoFilter(speedNum);
      audioFilters.push(...atempoFilters);
    }
  }

  return audioFilters;
}

function buildAtempoFilter(speed) {
  const filters = [];
  let remainingSpeed = speed;

  // Validación
  if (speed <= 0) {
    logger.warn(`Invalid speed ${speed}, defaulting to 1.0`);
    return [];
  }

  // Dividir en múltiples filtros atempo si es necesario
  if (speed < 0.5) {
    while (remainingSpeed < 0.5) {
      filters.push('atempo=0.5');
      remainingSpeed *= 2;
    }
    if (remainingSpeed > 0.5 && remainingSpeed < 1) {
      filters.push(`atempo=${remainingSpeed.toFixed(4)}`);
    }
  } else if (speed > 2) {
    while (remainingSpeed > 2) {
      filters.push('atempo=2.0');
      remainingSpeed /= 2;
    }
    if (remainingSpeed > 1 && remainingSpeed <= 2) {
      filters.push(`atempo=${remainingSpeed.toFixed(4)}`);
    }
  } else if (speed !== 1) {
    filters.push(`atempo=${speed.toFixed(4)}`);
  }

  return filters;
}

function applyAudioOptions(command, { removeAudio, presetConfig, normalizeAudio, speed }) {
  if (removeAudio) {
    command.noAudio();
    return;
  }

  if (!presetConfig.audioCodec) {
    // Si no hay codec de audio definido, copiar el stream original
    command.audioCodec('copy');
    return;
  }

  // Aplicar codec y bitrate
  command.audioCodec(presetConfig.audioCodec);

  if (presetConfig.audioBitrate) {
    command.audioBitrate(presetConfig.audioBitrate);
  }

  // Construir y aplicar filtros de audio
  const audioFilters = buildAudioFilters({ normalizeAudio, speed });

  if (audioFilters.length > 0) {
    const filterString = audioFilters.join(',');
    command.audioFilters(filterString);
    logger.info(`Applied audio filters: ${filterString}`);
  }
}

function buildOutputOptions({ presetConfig, jobId, customOptions = [] }) {
  const outputOptions = [];
  if (presetConfig.crf) {
    outputOptions.push(`-crf`, `${presetConfig.crf}`);
  }
  if (presetConfig.preset) {
    outputOptions.push(`-preset`, `${presetConfig.preset}`);
  }
  if (presetConfig.extraOptions) {
    outputOptions.push(...presetConfig.extraOptions);
  }
  if (customOptions.length > 0 && presetConfig.allowCustomOptions !== false) {
    outputOptions.push(...customOptions);
  }
  return outputOptions;
}

// Aplicar opciones al comando
function applyCommandOptions(command, options, presetConfig, preset, format) {
  const {
    startTime,
    duration,
    resolution,
    speed = 1,
    removeAudio = false,
    denoise = false,
    stabilize = false,
    crop = null,
    rotate = null,
    flip = null,
    subtitles = null,
    normalizeAudio = false,
    customOptions = []
  } = options;

  // Validar compatibilidad de conversión
  const validation = validateConversionCompatibility(preset, format, presetConfig);
  if (!validation.valid) {
    throw new Error(`Incompatibilidad detectada: ${validation.message}`);
  }

  // Punto de inicio y duración
  if (startTime !== null && startTime !== undefined && startTime > 0) {
    command.setStartTime(Number.parseFloat(startTime));
  }

  if (duration !== null && duration !== undefined && duration > 0) {
    command.setDuration(Number.parseFloat(duration));
  }

  // Construir filtros de video
  const videoFilters = buildVideoFilters({
    speed,
    denoise,
    stabilize,
    crop,
    rotate,
    flip,
    subtitles
  });

  if (videoFilters.length > 0) {
    const filterString = videoFilters.join(',');
    command.videoFilters(filterString);
    logger.info(`Applied video filters: ${filterString}`);
  }

  // Codec de video
  if (presetConfig.videoCodec) {
    command.videoCodec(presetConfig.videoCodec);
  }

  // Resolución
  if (resolution || presetConfig.resolution) {
    const targetResolution = resolution || presetConfig.resolution;
    command.size(targetResolution);
    logger.info(`Applied resolution: ${targetResolution}`);
  }

  // FPS
  if (presetConfig.fps) {
    command.fps(presetConfig.fps);
  }

  // Aplicar opciones de audio
  applyAudioOptions(command, {
    removeAudio,
    presetConfig,
    normalizeAudio,
    speed
  });

  // Opciones de salida (CRF, preset, etc.)
  const outputOptions = buildOutputOptions({
    presetConfig,
    customOptions
  });

  if (outputOptions.length > 0) {
    command.outputOptions(outputOptions);
  }

  // === APLICAR FORMATO DE SALIDA (MEJORADO) ===
  const resolvedFormat = applyOutputFormat(command, preset, format, presetConfig);
  logger.info(`Output format resolved: ${resolvedFormat} (requested: ${format})`);

  return command;
}

// Verificar si el archivo existe y está accesible
const waitForFile = async (filePath, maxAttempts = 10, delayMs = 500) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fs.access(filePath, fsSync.constants.R_OK);
      const stats = await fs.stat(filePath);
      if (stats.size > 0) {
        return true;
      }
    } catch (err) {
      logger.warn(`Attempt ${i + 1} to access file failed: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`File not accessible after ${maxAttempts} attempts: ${filePath}`);
};

// Convertir timemark a segundos
function timemarkToSeconds(timemark) {
  if (!timemark || timemark === 'N/A' || timemark === '00:00:00.00') return 0;

  // Manejar timemarks negativos
  const isNegative = timemark.startsWith('-');
  const cleanTimemark = timemark.replace('-', '');

  try {
    const parts = cleanTimemark.split(':');
    if (parts.length !== 3) return 0;

    const hours = Number.parseInt(parts[0]) || 0;
    const minutes = Number.parseInt(parts[1]) || 0;
    const seconds = Number.parseFloat(parts[2]) || 0;

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    return isNegative ? 0 : totalSeconds;
  } catch (error) {
    logger.warn(`Error parsing timemark: ${timemark}`, error);
    return 0;
  }
}

// Obtener duración del video con ffprobe
const getVideoDuration = async (inputPath) => {
  try {
    // Esperar a que el archivo esté disponible
    await waitForFile(inputPath);

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          logger.error(` Could not get duration for ${inputPath}:`, err.message);
          reject(err instanceof Error ? err : new Error(String(err)));
        } else {
          const duration = metadata.format.duration;
          if (!duration || duration <= 0) {
            logger.warn(` Invalid duration detected: ${duration}s`);
            reject(new Error('Invalid video duration'));
          } else {
            resolve(duration);
          }
        }
      });
    });
  } catch (error) {
    logger.error(`Failed to verify or probe file ${inputPath}:`, error.message);
    throw error;
  }
};

// ===================== CONVERSIÓN CON PROGRESO =====================

function handleProgressEvent({
  jobId,
  progress,
  totalDuration,
  lastProgress,
  lastLoggedProgress,
  startTime,
  redis,
  jobManager,
  io
}) {
  // timemark actual / duración total
  const currentTimeSeconds = timemarkToSeconds(progress.timemark);

  if (currentTimeSeconds <= 0 || !totalDuration || totalDuration <= 0) {
    return { lastProgress, lastLoggedProgress };
  }

  // Calcular porcentaje: (tiempo actual / duración total)
  let currentProgress = Math.round((currentTimeSeconds / totalDuration) * 100);

  // Asegurar que esté entre 0 y 99
  currentProgress = Math.max(0, Math.min(99, currentProgress));

  // Solo actualizar si hay cambio 
  if (currentProgress === lastProgress) {
    return { lastProgress, lastLoggedProgress };
  }

  lastProgress = currentProgress;

  // Log detallado cada 5% o en ciertos puntos clave
  if (
    currentProgress !== lastLoggedProgress &&
    (currentProgress % 5 === 0 || currentProgress > 95)
  ) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const eta =
      currentProgress > 0
        ? Math.round((elapsed / currentProgress) * (100 - currentProgress))
        : 0;

    logger.info(
      `Job ${jobId} - ${currentProgress}% | ` +
      `Time: ${progress.timemark}/${formatDuration(totalDuration)} | ` +
      `FPS: ${progress.currentFps || 0} | ` +
      `Speed: ${progress.currentKbps
        ? (progress.currentKbps / 1000).toFixed(2) + "x"
        : "N/A"
      } | ` +
      `ETA: ${formatDuration(eta)}`
    );
    lastLoggedProgress = currentProgress;
  }

  const progressData = {
    status: "processing",
    progress: currentProgress,
    currentTime: progress.timemark || "00:00:00",
    totalTime: formatDuration(totalDuration),
    fps: progress.currentFps || 0,
    speed: progress.currentKbps
      ? `${(progress.currentKbps / 1000).toFixed(2)}x`
      : "0x",
    updatedAt: Date.now(),
  };

  // Guardar en Redis
  redis.hset(`job:${jobId}`, progressData);

  // Actualizar jobManager local
  jobManager.updateJob(jobId, progressData);

  // Publicar evento
  redis.publish(
    "job:progress",
    JSON.stringify({
      jobId,
      ...progressData,
    })
  );

  // Emitir via Socket.IO
  io.to(jobId).emit("job:update", {
    id: jobId,
    jobId: jobId,
    ...progressData,
  });

  return { lastProgress, lastLoggedProgress };
}

async function handleJobError(jobId, err, redis, jobManager, io, reject) {
  logger.error(`Job ${jobId} failed:`, err);

  const errorData = {
    status: "failed",
    progress: 0,
    error: err.message || String(err),
  };

  // Actualizar Redis
  await redis.hset(`job:${jobId}`, errorData);

  // Actualizar jobManager
  jobManager.updateJob(jobId, errorData);

  // Publicar evento de error
  await redis.publish(
    "job:failed",
    JSON.stringify({
      jobId,
      error: err.message || String(err),
    })
  );

  // Emitir via Socket.IO
  io.to(jobId).emit("job:update", {
    id: jobId,
    jobId: jobId,
    ...errorData,
  });

  reject(err instanceof Error ? err : new Error(String(err)));
}

// Validar duración solicitada vs duración real del video
async function getValidatedDuration(inputPath, startTime, duration, jobId) {
  const fileExists = await fs.access(inputPath)
    .then(() => true)
    .catch(() => false);
  if (!fileExists) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }
  let totalDuration = await getVideoDuration(inputPath);
  if (duration !== null && duration > 0) {
    totalDuration = Math.min(duration, totalDuration - (startTime || 0));
  } else if (startTime !== null && startTime > 0) {
    totalDuration = totalDuration - startTime;
  }
  return totalDuration;
}

// Validar presets raw para duración máxima
async function validateRawPreset(preset, duration) {
  const rawPresets = [
    'raw-uncompressed',
    'avi-uncompressed',
    'avi-uncompressed-rgb'
  ];

  if (rawPresets.includes(preset)) {
    const presetConfig = PRESETS[preset];

    if (presetConfig.maxDuration && duration > presetConfig.maxDuration) {
      throw new Error(
        `El preset "${preset}" está limitado a ${presetConfig.maxDuration} segundos ` +
        `para evitar archivos masivos. Tu video dura ${Math.round(duration)} segundos. ` +
        `Usa un preset con compresión lossless como "avi-ffv1" o "avi-lossless" en su lugar.`
      );
    }
  }
}

// LIMPIEZA DESPUÉS DE PROCESAMIENTO 
async function cleanupAfterProcessing(jobId, inputPath) {
  if (!cleanupConfig.deleteInputAfterProcessing) return;

  try {
    if (fsSync.existsSync(inputPath)) {
      await fs.unlink(inputPath);
      logger.info(`Deleted input file after processing: ${inputPath}`);
    }
  } catch (error) {
    logger.error(`Failed to delete input file ${inputPath}:`, error);
  }
}

//LIMPIEZA DESPUÉS DE DESCARGA DEL USUARIO
async function scheduleCleanupAfterDownload(jobId, outputPath) {
  if (!cleanupConfig.deleteOutputAfterDownload) return;

  const tracking = downloadTracker.get(jobId);
  if (!tracking) return;

  // Verificar si alcanzó el límite de descargas
  if (tracking.count >= cleanupConfig.maxDownloads) {
    // Esperar a que NO haya descargas activas
    const checkInterval = setInterval(async () => {
      if (!isBeingDownloaded(jobId)) {
        clearInterval(checkInterval);

        // Esperar un tiempo prudencial adicional
        setTimeout(async () => {
          try {
            // Doble verificación
            if (isBeingDownloaded(jobId)) {
              logger.warn(`Job ${jobId} still being downloaded, postponing cleanup`);
              return;
            }

            if (fsSync.existsSync(outputPath)) {
              await fs.unlink(outputPath);
              logger.info(`✓ Deleted output file after ${tracking.count} download(s): ${outputPath}`);
            }

            // Limpiar el job del sistema
            const job = jobManager.getJob(jobId);
            if (job?.inputPath && fsSync.existsSync(job.inputPath)) {
              await fs.unlink(job.inputPath);
              logger.info(`✓ Deleted input file: ${job.inputPath}`);
            }

            jobManager.deleteJob(jobId);
            await redis.del(`job:${jobId}`);
            downloadTracker.delete(jobId);

            logger.info(`✓ Cleaned up job ${jobId} after successful download`);
          } catch (err) {
            logger.error(`Error in cleanup for job ${jobId}:`, err);
          }
        }, 5000); // 5 segundos después de que termine la última descarga activa
      }
    }, 1000); // Verificar cada segundo

    // Timeout de seguridad (5 minutos)
    setTimeout(() => {
      clearInterval(checkInterval);
      logger.warn(`Cleanup timeout for job ${jobId}, forcing cleanup`);
      scheduleCleanupAfterDownload(jobId, outputPath);
    }, 300000);
  }
}

// Función principal de conversión con progreso
const convertVideoWithProgress = async (
  jobId,
  inputPath,
  outputPath,
  options = {},
  bullJob = null
) => {
  const {
    preset = "h264-normal",
    format = "mp4",
    startTime = null,
    duration = null,
    speed = 1,
  } = options;

  if (speed && speed !== 1) {
    const speedNum = Number.parseFloat(speed);
    if (Number.isNaN(speedNum) || speedNum <= 0 || speedNum < 0.25 || speedNum > 4) {
      throw new Error('Speed must be between 0.25x and 4.0x');
    }
  }

  let totalDuration;
  try {
    totalDuration = await getValidatedDuration(inputPath, startTime, duration, jobId);
    await validateRawPreset(preset, totalDuration);
  } catch (error) {
    logger.error(`Job ${jobId} - Validation failed:`, error);
    const errorMessage = error.message || `Cannot process video: ${error}`;

    await redis.hset(`job:${jobId}`, {
      status: "failed",
      error: errorMessage,
    });

    jobManager.updateJob(jobId, {
      status: "failed",
      error: errorMessage,
    });

    await redis.publish("job:failed", JSON.stringify({ jobId, error: errorMessage }));
    throw error;
  }

  const presetConfig = PRESETS[preset] || PRESETS["h264-normal"];
  let command = ffmpeg(inputPath);

  // Guardar referencia del comando FFmpeg
  activeFFmpegProcesses.set(jobId, command);

  applyCommandOptions(command, options, presetConfig, preset, format);

  let progressUpdateInterval = null;
  let isCancelled = false;

  return new Promise((resolve, reject) => {
    let lastProgress = -1;
    let lastLoggedProgress = -1;
    const startTimeMs = Date.now();

    command
      .on("progress", async (progress) => {
        if (isCancelled) return;

        try {
          const result = handleProgressEvent({
            jobId, progress, totalDuration, lastProgress, lastLoggedProgress,
            startTime: startTimeMs, redis, jobManager, io,
          });
          lastProgress = result.lastProgress;
          lastLoggedProgress = result.lastLoggedProgress;
        } catch (error) {
          logger.error(`Error updating progress for job ${jobId}:`, error);
        }
      })
      .on("end", async () => {
        if (isCancelled) return;

        try {
          if (progressUpdateInterval) clearInterval(progressUpdateInterval);
          activeFFmpegProcesses.delete(jobId);

          const totalTime = Math.round((Date.now() - startTimeMs) / 1000);
          logger.info(`Job ${jobId} - Encoding completed in ${formatDuration(totalTime)}`);

          const outputInfo = await getMediaInfo(outputPath);
          const outputStats = await fs.stat(outputPath);
          const processingTime = Date.now() - jobManager.getJob(jobId).createdAt;

          const result = {
            success: true,
            outputPath,
            outputSize: outputStats.size,
            outputSizeFormatted: formatSize(outputStats.size),
            outputInfo,
            processingTime,
            processingTimeFormatted: formatDuration(processingTime / 1000),
          };

          await redis.hset(`job:${jobId}`, {
            status: "completed",
            progress: 100,
            result: JSON.stringify(result),
            completedAt: Date.now(),
          });

          jobManager.updateJob(jobId, {
            status: "completed",
            progress: 100,
            result,
            completedAt: Date.now(),
          });

          await redis.publish("job:completed", JSON.stringify({ jobId, result }));

          io.to(jobId).emit("job:update", {
            id: jobId,
            jobId: jobId,
            status: "completed",
            progress: 100,
            result,
          });

          await cleanupAfterProcessing(jobId, inputPath);
          logger.info(`Job ${jobId} completed successfully in ${formatDuration(totalTime)}`);
          resolve(result);
        } catch (error) {
          logger.error(`Error finalizing job ${jobId}:`, error);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })
      .on("error", async (err) => {
        if (progressUpdateInterval) clearInterval(progressUpdateInterval);
        activeFFmpegProcesses.delete(jobId);

        // Si fue cancelado, no tratarlo como error
        if (isCancelled) {
          logger.info(`Job ${jobId} was cancelled by user`);
          return; // No llamar reject
        }

        try {
          await handleJobError(jobId, err, redis, jobManager, io, reject);
        } catch (error) {
          logger.error(`Error handling job ${jobId} failure:`, error);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })
      .save(outputPath);

    // Función para cancelar el proceso
    command.cancel = () => {
      isCancelled = true;
      try {
        command.kill('SIGKILL'); // Matar el proceso FFmpeg
        logger.info(`FFmpeg process killed for job ${jobId}`);
      } catch (err) {
        logger.error(`Error killing FFmpeg for job ${jobId}:`, err);
      }
    };

    progressUpdateInterval = setInterval(async () => {
      if (isCancelled) return;

      try {
        const jobData = await redis.hgetall(`job:${jobId}`);
        if (jobData?.status === "processing") {
          const lastUpdate = Number.parseInt(jobData.updatedAt || 0);
          const now = Date.now();

          if (now - lastUpdate > 20000) {
            logger.warn(
              `Job ${jobId} seems stalled (last update: ${Math.round(
                (now - lastUpdate) / 1000
              )}s ago)`
            );

            io.to(jobId).emit("job:warning", {
              id: jobId,
              jobId: jobId,
              message: "Processing appears to be stalled",
              lastUpdate: new Date(lastUpdate).toISOString(),
            });
          }
        }
      } catch (error) {
        logger.error(`Error in progress interval for job ${jobId}:`, error);
      }
    }, 10000);
  });
};

// ===================== RUTAS DE LA API =====================

// Comprobar estado del servidor
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    redis: redis.status,
    jobs: {
      total: jobManager.jobs.size,
      queued: Array.from(jobManager.jobs.values()).filter(j => j.status === 'queued').length,
      processing: Array.from(jobManager.jobs.values()).filter(j => j.status === 'processing').length,
      completed: Array.from(jobManager.jobs.values()).filter(j => j.status === 'completed').length,
      failed: Array.from(jobManager.jobs.values()).filter(j => j.status === 'failed').length
    }
  });
});

// Obtener presets disponibles
app.get('/api/presets', (req, res) => {
  res.json(PRESETS);
});

// Obtener formatos soportados
app.get('/api/formats', async (req, res) => {
  try {
    const { stdout } = await execPromise('ffmpeg -formats');
    const formats = stdout.split('\n')
      .filter(line => /^\s*[DE]/.exec(line))
      .map(line => {
        const regex = /^\s*([DE]+)\s+(\S+)\s+(.*)/;
        const match = regex.exec(line);
        if (match) {
          return {
            support: match[1],
            format: match[2],
            description: match[3].trim()
          };
        }
      })
      .filter(Boolean);

    res.json(formats);
  } catch (error) {
    logger.error('Failed to get formats:', error);
    res.status(500).json({ error: 'Failed to get formats' });
  }
});

// Obtener códecs soportados
app.get('/api/codecs', async (req, res) => {
  try {
    const { stdout } = await execPromise('ffmpeg -codecs');
    const codecs = stdout.split('\n')
      .filter(line => /^\s*[DEVASIL]/.exec(line))
      .map(line => {
        const regex = /^\s*([DEVASIL.]+)\s+(\S+)\s+(.*)/;
        const match = regex.exec(line);
        if (match) {
          return {
            support: match[1],
            codec: match[2],
            description: match[3].trim()
          };
        }
      })
      .filter(Boolean);

    res.json({
      video: codecs.filter(c => c.support.includes('V')),
      audio: codecs.filter(c => c.support.includes('A'))
    });
  } catch (error) {
    logger.error('Failed to get codecs:', error);
    res.status(500).json({ error: 'Failed to get codecs' });
  }
});

app.get('/api/job/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;

    // Primero intentar desde jobManager
    let job = jobManager.getJob(jobId);

    // Si no está en memoria, buscar en Redis
    if (!job) {
      const jobData = await redis.hgetall(`job:${jobId}`);
      if (jobData && Object.keys(jobData).length > 0) {
        job = {
          id: jobId,
          status: jobData.status,
          progress: Number.parseInt(jobData.progress || 0),
          currentTime: jobData.currentTime,
          fps: Number.parseFloat(jobData.fps || 0),
          speed: jobData.speed,
          error: jobData.error,
          result: jobData.result ? JSON.parse(jobData.result) : null,
          createdAt: Number.parseInt(jobData.createdAt || Date.now()),
          updatedAt: Number.parseInt(jobData.updatedAt || Date.now())
        };
      }
    }

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    logger.error('Error fetching job:', error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// Análisis de archivo multimedia
app.post('/api/analyze', upload.single('media'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const info = await getMediaInfo(filePath);
    const hash = await calculateFileHash(filePath);

    res.json({
      file: {
        name: req.file.originalname,
        size: req.file.size,
        path: filePath,
        hash
      },
      info,
      suggestions: suggestOptimalSettings(info)
    });

    //Eliminar archivo después del análisis
    setTimeout(async () => {
      try {
        if (fsSync.existsSync(filePath)) {
          await fs.unlink(filePath);
          logger.info(`✓ Deleted analyzed file: ${filePath}`);
        }
      } catch (err) {
        logger.error(`Failed to delete analyzed file ${filePath}:`, err);
      }
    }, 5000);

  } catch (error) {
    logger.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze media', details: error.message });

    // Limpiar archivo en caso de error
    if (req.file?.path && fsSync.existsSync(req.file.path)) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        logger.error('Failed to cleanup file after error:', unlinkError);
      }
    }
  }
});

// Sugerencias de configuración óptima basadas en el análisis
const suggestOptimalSettings = (info) => {
  const suggestions = [];

  if (info.video) {
    // Sugerencias de resolución
    if (info.video.width >= 3840) {
      suggestions.push({
        type: 'resolution',
        message: 'Video 4K detectado. Considerar ajustar a 1080p para la mayoría de los usos.',
        preset: 'youtube-1080p'
      });
    }

    // Sugerencias de codec
    if (info.video.codec === 'h264' || info.video.codec === 'avc') {
      suggestions.push({
        type: 'codec',
        message: 'Video en H.264. Considerar H.265/HEVC para 50% mejor compresión con misma calidad.',
        preset: 'h265-normal'
      });
    } else if (info.video.codec === 'mpeg4' || info.video.codec === 'xvid') {
      suggestions.push({
        type: 'codec',
        message: 'Codec antiguo detectado. Recomendamos actualizar a H.264 o H.265.',
        preset: 'h264-normal'
      });
    } else if (info.video.codec === 'vp8') {
      suggestions.push({
        type: 'codec',
        message: 'VP8 detectado. Considerar VP9 para mejor compresión web.',
        preset: 'vp9-web'
      });
    }

    // Sugerencias de FPS
    if (info.video.fps > 60) {
      suggestions.push({
        type: 'fps',
        message: `Alta tasa de fotogramas detectada (${Math.round(info.video.fps)}fps). Considerar 60fps o 30fps para reducir tamaño.`,
        option: { fps: 60 }
      });
    }

    // Sugerencias de bitrate excesivo
    if (info.video.bitrate > 20000000) { // > 20 Mbps
      suggestions.push({
        type: 'bitrate',
        message: 'Bitrate muy alto detectado. Puedes reducir significativamente el tamaño sin pérdida notable.',
        preset: 'h264-high'
      });
    }
  }


  return suggestions;
};

// Limpia archivo subido en caso de error
async function cleanupUploadedFile(filePath) {
  if (filePath && fsSync.existsSync(filePath)) {
    try {
      await fs.unlink(filePath);
      logger.info(`Cleaned up uploaded file: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to cleanup file ${filePath}:`, error);
    }
  }
}

// Valida y normaliza las opciones de conversión
function parseConversionOptions(body) {
  const {
    preset = 'h264-normal',
    format = 'mp4',
    resolution,
    startTime,
    duration,
    removeAudio,
    subtitles,
    normalizeAudio,
    denoise,
    stabilize,
    speed,
    crop,
    rotate,
    flip,
    customOptions = []
  } = body;

  return {
    preset,
    format,
    resolution,
    startTime: startTime ? Number.parseFloat(startTime) : null,
    duration: duration ? Number.parseFloat(duration) : null,
    removeAudio: removeAudio === 'true',
    subtitles,
    normalizeAudio: normalizeAudio === 'true',
    denoise: denoise === 'true',
    stabilize: stabilize === 'true',
    speed: speed ? Number.parseFloat(speed) : 1,
    crop,
    rotate: rotate ? Number.parseFloat(rotate) : null,
    flip,
    customOptions: Array.isArray(customOptions) ? customOptions : []
  };
}

// Valida compatibilidad y retorna error si no es válida
async function validateAndGetFormat(preset, format, filePath) {
  const presetConfig = PRESETS[preset] || PRESETS['h264-normal'];
  const validation = validateConversionCompatibility(preset, format, presetConfig);

  if (!validation.valid) {
    // Limpiar archivo subido
    await cleanupUploadedFile(filePath);

    return {
      error: {
        status: 400,
        body: {
          error: 'Configuración incompatible',
          message: validation.message,
          suggestedFormats: validation.suggestedFormats,
          supportedVideoCodecs: validation.supportedVideoCodecs,
          supportedAudioCodecs: validation.supportedAudioCodecs
        }
      }
    };
  }

  const resolvedFormat = resolveOutputFormat(preset, format, presetConfig);
  return { resolvedFormat, presetConfig };
}

// Crea y encola un trabajo de conversión
async function createConversionJob(file, resolvedFormat, options, userId) {
  const inputPath = file.path;
  const outputFilename = `${path.parse(file.filename).name}_converted.${resolvedFormat}`;
  const outputPath = path.join(dirs.outputs, outputFilename);

  // Crear job en jobManager
  const job = jobManager.createJob({
    type: 'conversion',
    inputPath,
    outputPath,
    inputName: file.originalname,
    outputName: outputFilename,
    options,
    userId
  });

  logger.info(`Job created: ${job.id} for file: ${file.originalname}`);

  // Guardar en Redis
  await redis.hset(`job:${job.id}`, {
    status: 'queued',
    progress: 0,
    inputName: file.originalname,
    outputName: outputFilename,
    createdAt: Date.now()
  });

  // Encolar en Bull
  const bullJob = await videoQueue.add({
    jobId: job.id,
    inputPath,
    outputPath,
    options: {
      ...options,
      format: resolvedFormat
    }
  });

  jobManager.setBullJobId(job.id, bullJob.id);

  return {
    job,
    outputFilename,
    resolvedFormat
  };
}

// Conversión de video/audio
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const options = parseConversionOptions(req.body);
    const { preset, format } = options;

    const validation = await validateAndGetFormat(preset, format, req.file.path);
    if (validation.error) {
      return res.status(validation.error.status).json(validation.error.body);
    }

    const { resolvedFormat } = validation;

    // Obtener userId (desde header o generar uno temporal)
    const userId = req.headers['x-user-id'] || `temp-${uuidv4()}`;

    const { job, outputFilename } = await createConversionJob(
      req.file,
      resolvedFormat,
      options,
      userId
    );

    // Agregar asociación job-user
    associateJobWithUser(job.id, userId);

    res.status(201).json({
      jobId: job.id,
      userId: userId, // Devolver userId para que el frontend lo use
      status: 'queued',
      inputName: req.file.originalname,
      outputName: outputFilename,
      resolvedFormat,
      requestedFormat: format,
      formatAdjusted: resolvedFormat !== format,
      message: resolvedFormat === format
        ? 'Video conversion job created successfully'
        : `Formato ajustado de "${format}" a "${resolvedFormat}" para compatibilidad con preset "${preset}"`
    });

  } catch (error) {
    logger.error('Conversion error:', error);
    await cleanupUploadedFile(req.file?.path);

    res.status(500).json({
      error: 'Failed to start conversion',
      details: error.message
    });
  }
});

// Conversión por lotes
app.post('/api/batch-convert', upload.array('videos', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const jobs = [];
    const options = JSON.parse(req.body.options || '{}');

    for (const file of req.files) {
      const inputPath = file.path;
      const outputFilename = `${path.parse(file.filename).name}_converted.${options.format || 'mp4'}`;
      const outputPath = path.join(dirs.outputs, outputFilename);

      const job = jobManager.createJob({
        type: 'batch-conversion',
        inputPath,
        outputPath,
        inputName: file.originalname,
        outputName: outputFilename,
        options,
        userId: req.headers['x-user-id'] || 'anonymous'
      });

      await videoQueue.add({
        jobId: job.id,
        inputPath,
        outputPath,
        options
      });

      jobs.push(job.id);
    }

    res.json({
      jobs,
      message: `${jobs.length} conversion jobs created successfully`
    });

  } catch (error) {
    logger.error('Batch conversion error:', error);
    res.status(500).json({ error: 'Failed to start batch conversion', details: error.message });
  }
});

// Validar configuración de conversión
app.post('/api/validate-conversion', (req, res) => {
  try {
    const { preset, format } = req.body;

    const allowedPresets = Object.keys(PRESETS);
    if (!allowedPresets.includes(preset)) {
      throw new Error('Invalid preset');
    }

    const presetConfig = PRESETS[preset] || PRESETS['h264-normal'];
    const validation = validateConversionCompatibility(preset, format, presetConfig);

    if (!validation.valid) {
      return res.status(400).json({
        valid: false,
        error: validation.message,
        suggestedFormats: validation.suggestedFormats,
        supportedVideoCodecs: validation.supportedVideoCodecs,
        supportedAudioCodecs: validation.supportedAudioCodecs
      });
    }

    const resolvedFormat = resolveOutputFormat(preset, format, presetConfig);

    res.json({
      valid: true,
      message: validation.message,
      preset: preset,
      requestedFormat: format,
      resolvedFormat: resolvedFormat,
      videoCodec: presetConfig.videoCodec,
      audioCodec: presetConfig.audioCodec,
      willAutoAdjust: resolvedFormat !== format
    });

  } catch (error) {
    res.status(500).json({
      valid: false,
      error: 'Error validando configuración',
      details: error.message
    });
  }
});

// Obtener todos los jobs
app.get('/api/jobs', (req, res) => {
  const userId = req.headers['x-user-id'];
  const jobs = jobManager.getAllJobs(userId);

  res.json(jobs);
});

// Cancelar job
app.delete('/api/job/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  try {
    logger.info(`Attempting to cancel job ${jobId} (status: ${job.status})`);

    // Detener el proceso FFmpeg si está activo
    const ffmpegCommand = activeFFmpegProcesses.get(jobId);
    if (ffmpegCommand && typeof ffmpegCommand.cancel === 'function') {
      logger.info(`Killing FFmpeg process for job ${jobId}`);
      ffmpegCommand.cancel();
      activeFFmpegProcesses.delete(jobId);
    }

    // Cancelar el job en Bull queue
    const bullJobId = jobManager.getBullJobId(jobId);
    if (bullJobId) {
      try {
        const bullJob = await videoQueue.getJob(bullJobId);
        if (bullJob) {
          const state = await bullJob.getState();
          logger.info(`Bull job ${bullJobId} state: ${state}`);

          // Intentar remover el job según su estado
          if (state === 'active') {
            // Si está activo, solo FFmpeg lo detendrá
            await bullJob.remove();
            logger.info(`Removed active Bull job ${bullJobId}`);
          } else if (state === 'waiting' || state === 'delayed') {
            await bullJob.remove();
            logger.info(`Removed waiting/delayed Bull job ${bullJobId}`);
          }
        }
      } catch (bullError) {
        logger.warn(`Could not remove Bull job ${bullJobId}:`, bullError.message);
      }
    }

    // Actualizar estado en Redis y jobManager
    await redis.hset(`job:${jobId}`, {
      status: 'cancelled',
      cancelledAt: Date.now(),
      progress: 0
    });

    jobManager.updateJob(jobId, {
      status: 'cancelled',
      cancelledAt: Date.now(),
      progress: 0
    });

    // Notificar a través de Socket.IO
    io.to(jobId).emit('job:update', {
      id: jobId,
      jobId: jobId,
      status: 'cancelled',
      progress: 0,
      cancelledAt: Date.now()
    });

    // Programar limpieza de archivos
    setTimeout(async () => {
      try {
        if (job.inputPath && fsSync.existsSync(job.inputPath)) {
          await fs.unlink(job.inputPath);
          logger.info(`Deleted input file of cancelled job: ${job.inputPath}`);
        }
        if (job.outputPath && fsSync.existsSync(job.outputPath)) {
          await fs.unlink(job.outputPath);
          logger.info(`Deleted partial output file of cancelled job: ${job.outputPath}`);
        }

        jobManager.deleteJob(jobId);
        await redis.del(`job:${jobId}`);
        downloadTracker.delete(jobId);

        logger.info(`Cleanup completed for cancelled job ${jobId}`);
      } catch (err) {
        logger.error(`Error cleaning cancelled job ${jobId}:`, err);
      }
    }, 2000);

    res.json({
      message: 'Job cancelled successfully',
      jobId: jobId,
      status: 'cancelled'
    });

  } catch (error) {
    logger.error('Cancel job error:', error);
    res.status(500).json({
      error: 'Failed to cancel job',
      details: error.message
    });
  }
});

// Descargar archivo convertido
app.get('/api/download/:jobId', async (req, res) => {
  const job = jobManager.getJob(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'completed') {
    return res.status(409).json({ error: 'Job not completed yet' });
  }

  if (!fsSync.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Output file not found' });
  }

  const clientId = `${req.ip}-${Date.now()}`;
  const jobId = req.params.jobId;

  // Marcar inicio de descarga
  startDownload(jobId, clientId);

  // Stream el archivo
  const fileStream = fsSync.createReadStream(job.outputPath);

  // Configurar headers
  res.setHeader('Content-Disposition', `attachment; filename="${job.outputName}"`);
  res.setHeader('Content-Type', 'application/octet-stream');

  let downloadSuccess = false;

  // Cuando termina la transferencia
  fileStream.on('end', () => {
    downloadSuccess = true;
    finishDownload(jobId, clientId, true);

    // Programar limpieza SOLO si se descargó completamente
    scheduleCleanupAfterDownload(jobId, job.outputPath);
  });

  // Si hay error en la transferencia
  fileStream.on('error', (err) => {
    logger.error(`Stream error for job ${jobId}:`, err);
    finishDownload(jobId, clientId, false);
  });

  // Si el cliente cancela la descarga
  req.on('close', () => {
    if (!downloadSuccess) {
      logger.warn(`Client ${clientId} disconnected before completing download of job ${jobId}`);
      finishDownload(jobId, clientId, false);
      fileStream.destroy();
    }
  });

  // Enviar archivo
  fileStream.pipe(res);
});

// Transmitir video convertido
app.get('/api/stream/:jobId', async (req, res) => {
  const job = jobManager.getJob(req.params.jobId);

  if (job?.status !== 'completed') {
    return res.status(404).json({ error: 'Video not available' });
  }

  const videoPath = job.outputPath;
  const stat = await fs.stat(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = Number.parseInt(parts[0], 10);
    const end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fsSync.createReadStream(videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fsSync.createReadStream(videoPath).pipe(res);
  }
});

// Obtener formatos compatibles para un preset dado
app.get('/api/preset/:preset/formats', (req, res) => {
  try {
    const preset = req.params.preset;
    const presetConfig = PRESETS[preset];

    if (!presetConfig) {
      return res.status(404).json({ error: 'Preset not found' });
    }

    const compatibleFormats = PRESET_FORMAT_COMPATIBILITY[preset];

    if (compatibleFormats) {
      res.json({
        preset,
        flexible: false,
        compatibleFormats,
        requiredFormat: presetConfig.outputFormat || compatibleFormats[0],
        message: `Este preset requiere formato específico: ${compatibleFormats.join(' o ')}`
      });
    } else {
      // Preset flexible - soporta múltiples formatos
      res.json({
        preset,
        flexible: true,
        compatibleFormats: ['mp4', 'mkv', 'mov', 'avi', 'webm'],
        message: 'Este preset es flexible y funciona con múltiples formatos'
      });
    }

  } catch (error) {
    res.status(500).json({
      error: 'Error obteniendo formatos compatibles',
      details: error.message
    });
  }
});

// Obtener códecs compatibles para un formato dado
app.get('/api/format/:format/codecs', (req, res) => {
  try {
    const format = req.params.format;
    const codecs = FORMAT_CODEC_COMPATIBILITY[format];

    if (!codecs) {
      return res.status(404).json({
        error: 'Formato no soportado',
        supportedFormats: Object.keys(FORMAT_CODEC_COMPATIBILITY)
      });
    }

    res.json({
      format,
      videoCodecs: codecs.video,
      audioCodecs: codecs.audio,
      supportsAudio: codecs.audio.length > 0
    });

  } catch (error) {
    res.status(500).json({
      error: 'Error obteniendo códecs compatibles',
      details: error.message
    });
  }
});

// Obtener estado de usuario y sus jobs
app.get('/api/user/:userId/status', (req, res) => {
  const userId = req.params.userId;

  const jobs = getUserJobs(userId);
  const connected = isUserConnected(userId);
  const activeSockets = userToSockets.get(userId)?.size || 0;

  res.json({
    userId,
    connected,
    activeSockets,
    jobs: jobs.map(jobId => {
      const job = jobManager.getJob(jobId);
      return {
        jobId,
        status: job?.status || 'unknown',
        progress: job?.progress || 0
      };
    })
  });
});

// ===================== SOCKET.IO =====================

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Asociar socket con userId
  socket.on('identify', (userId) => {
    associateSocketWithUser(socket.id, userId);
  });

  socket.on('subscribe', async (jobId, userId) => {
    try {
      // Si se proporciona userId en subscribe, asociar
      if (userId) {
        associateSocketWithUser(socket.id, userId);
        associateJobWithUser(jobId, userId);
      }

      socket.join(jobId);
      logger.info(`Client ${socket.id} subscribed to job ${jobId}`);

      // Enviar estado actual del job
      const job = jobManager.getJob(jobId);
      if (job) {
        socket.emit('job:update', {
          id: job.id,
          jobId: job.id,
          ...job
        });
      } else {
        const jobData = await redis.hgetall(`job:${jobId}`);
        if (jobData && Object.keys(jobData).length > 0) {
          socket.emit('job:update', {
            id: jobId,
            jobId: jobId,
            status: jobData.status,
            progress: Number.parseInt(jobData.progress || 0),
            currentTime: jobData.currentTime,
            fps: Number.parseFloat(jobData.fps || 0),
            speed: jobData.speed,
            error: jobData.error,
            result: jobData.result ? JSON.parse(jobData.result) : null
          });
        }
      }
    } catch (error) {
      logger.error(`Error subscribing to job ${jobId}:`, error);
    }
  });

  socket.on('unsubscribe', (jobId) => {
    socket.leave(jobId);
    logger.info(`Client ${socket.id} unsubscribed from job ${jobId}`);
  });

  socket.on('disconnect', async () => {
    logger.info(`Client disconnected: ${socket.id}`);

    // Verificar si el usuario está completamente desconectado
    const disconnectedUserId = disassociateSocket(socket.id);

    if (disconnectedUserId) {
      // Usuario completamente desconectado - iniciar limpieza
      logger.info(`User ${disconnectedUserId} fully disconnected, starting cleanup...`);

      // Pequeño delay por si el usuario se reconecta inmediatamente
      setTimeout(async () => {
        // Verificar de nuevo si el usuario sigue desconectado
        if (isUserConnected(disconnectedUserId)) {
          logger.info(`User ${disconnectedUserId} reconnected, skipping cleanup`);
          return;
        }
        const stats = await cleanupUserJobs(disconnectedUserId);
        logger.info(`Cleanup completed for user ${disconnectedUserId}:`, stats);
      }, 5000);
    }
  });

  // Nuevo evento: limpieza manual
  socket.on('cleanup-my-jobs', async (userId) => {
    if (!userId) return;

    logger.info(`Manual cleanup requested by user ${userId}`);
    const stats = await cleanupUserJobs(userId);
    socket.emit('cleanup-completed', stats);
  });
});

// ===================== FUNCIONES AUXILIARES PARA LIMPIEZA =====================

function isFileAssociatedWithJob(filePath) {
  return Array.from(jobManager.jobs.values()).some(
    job => job.inputPath === filePath || job.outputPath === filePath
  );
}

function findJobByOutputPath(filePath) {
  return Array.from(jobManager.jobs.values()).find(
    job => job.outputPath === filePath
  );
}

function shouldProtectFile(filePath) {
  const job = findJobByOutputPath(filePath);
  return job && isBeingDownloaded(job.id);
}

function isFileEligibleForCleanup(filePath, fileAge, retentionTime) {
  // Archivo no es lo suficientemente viejo
  if (fileAge <= retentionTime) {
    return false;
  }

  // Archivo está asociado a un job
  const hasJob = isFileAssociatedWithJob(filePath);
  if (hasJob) {
    // Proteger si está siendo descargado
    if (shouldProtectFile(filePath)) {
      logger.info(`Skipping cleanup of ${filePath} - actively downloading`);
      return false;
    }
    // Si tiene job pero no se está descargando, no limpiar aún
    return false;
  }

  // Es un archivo huérfano y es viejo, puede limpiarse
  return true;
}

async function safeDeleteFile(filePath) {
  try {
    await fs.unlink(filePath);
    logger.info(`✓ Cleaned orphan file: ${filePath}`);
    return true;
  } catch (err) {
    logger.error(`Failed to delete file ${filePath}:`, err);
    return false;
  }
}

async function processFileForCleanup(dirPath, fileName, now, retentionTime) {
  try {
    const filePath = path.join(dirPath, fileName);
    const stats = await fs.stat(filePath);
    const fileAge = now - stats.mtimeMs;

    if (isFileEligibleForCleanup(filePath, fileAge, retentionTime)) {
      const deleted = await safeDeleteFile(filePath);
      return deleted ? 1 : 0;
    }

    return 0;
  } catch (err) {
    logger.error(`Error processing file ${fileName}:`, err);
    return 0;
  }
}

async function cleanupDirectoryOrphans(dirPath, now, retentionTime) {
  try {
    const files = await fs.readdir(dirPath);
    let cleaned = 0;

    for (const file of files) {
      const result = await processFileForCleanup(dirPath, file, now, retentionTime);
      cleaned += result;
    }

    return cleaned;
  } catch (err) {
    logger.error(`Error reading directory ${dirPath}:`, err);
    return 0;
  }
}

async function cleanupOrphanFiles(now) {
  const directories = [dirs.uploads, dirs.outputs];
  let totalCleaned = 0;

  for (const dir of directories) {
    const cleaned = await cleanupDirectoryOrphans(dir, now, config.fileRetentionTime);
    totalCleaned += cleaned;
  }

  return totalCleaned;
}

// ===================== FUNCIONES AUXILIARES PARA LIMPIEZA DE JOBS =====================

function isFailedJobEligible(job, now) {
  return job.status === 'failed' &&
    (now - job.createdAt) > cleanupConfig.failedJobRetention;
}

function isDownloadedJobEligible(tracking, now) {
  if (!tracking?.fullyDownloaded || !tracking?.lastDownloadedAt) {
    return false;
  }
  return (now - tracking.lastDownloadedAt) > cleanupConfig.completedJobRetention;
}

function isUndownloadedJobEligible(job, now) {
  const retentionTime = cleanupConfig.completedJobRetention * 4;
  const jobTime = job.completedAt || job.createdAt;
  return (now - jobTime) > retentionTime;
}

function isCompletedJobEligible(job, now) {
  if (job.status !== 'completed') {
    return false;
  }

  const tracking = downloadTracker.get(job.id);

  if (isDownloadedJobEligible(tracking, now)) {
    return true;
  }

  if (isUndownloadedJobEligible(job, now)) {
    return true;
  }

  return false;
}

function isJobEligibleForCleanup(job, now) {
  // Job siendo descargado nunca es elegible
  if (isBeingDownloaded(job.id)) {
    logger.info(`Skipping cleanup of job ${job.id} - actively downloading`);
    return false;
  }

  // Verificar si es un job fallido viejo
  if (isFailedJobEligible(job, now)) {
    return true;
  }

  // Verificar si es un job completado viejo
  if (isCompletedJobEligible(job, now)) {
    return true;
  }

  return false;
}

async function deleteFileIfExists(filePath, description) {
  if (!filePath || !fsSync.existsSync(filePath)) {
    return false;
  }

  try {
    await fs.unlink(filePath);
    logger.info(`✓ Deleted ${description}: ${filePath}`);
    return true;
  } catch (err) {
    logger.error(`Failed to delete ${description} ${filePath}:`, err);
    return false;
  }
}

async function cleanupJobFiles(job) {
  await deleteFileIfExists(job.inputPath, 'input file of old job');
  await deleteFileIfExists(job.outputPath, 'output file of old job');
}

async function cleanupJobRecords(jobId) {
  try {
    jobManager.deleteJob(jobId);
    await redis.del(`job:${jobId}`);
    downloadTracker.delete(jobId);
    return true;
  } catch (err) {
    logger.error(`Failed to cleanup job records for ${jobId}:`, err);
    return false;
  }
}

async function processJobForCleanup(job, now) {
  if (!isJobEligibleForCleanup(job, now)) {
    return false;
  }

  try {
    await cleanupJobFiles(job);
    const success = await cleanupJobRecords(job.id);

    if (success) {
      logger.info(`✓ Cleaned up old job ${job.id} (status: ${job.status})`);
      return true;
    }

    return false;
  } catch (err) {
    logger.error(`Error cleaning job ${job.id}:`, err);
    return false;
  }
}

async function cleanupOldJobs(now) {
  const jobs = jobManager.getAllJobs();
  let cleaned = 0;

  for (const job of jobs) {
    const wasCleanedUp = await processJobForCleanup(job, now);
    if (wasCleanedUp) {
      cleaned++;
    }
  }

  return cleaned;
}

// ===================== LIMPIEZA AL DESCONECTAR =====================

// Cancelar y detener un job en ejecución
async function cancelJob(jobId) {
  const job = jobManager.getJob(jobId);
  if (!job) return false;

  logger.info(`Cancelling job ${jobId} (status: ${job.status})`);

  try {
    // Detener proceso FFmpeg si está activo
    const ffmpegCommand = activeFFmpegProcesses.get(jobId);
    if (ffmpegCommand && typeof ffmpegCommand.cancel === 'function') {
      logger.info(`Killing FFmpeg process for job ${jobId}`);
      ffmpegCommand.cancel();
      activeFFmpegProcesses.delete(jobId);
    }

    // Cancelar job en Bull queue
    const bullJobId = jobManager.getBullJobId(jobId);
    if (bullJobId) {
      try {
        const bullJob = await videoQueue.getJob(bullJobId);
        if (bullJob) {
          await bullJob.remove();
          logger.info(`Removed Bull job ${bullJobId}`);
        }
      } catch (bullError) {
        logger.warn(`Could not remove Bull job ${bullJobId}:`, bullError.message);
      }
    }

    // Actualizar estado
    await redis.hset(`job:${jobId}`, {
      status: 'cancelled',
      cancelledAt: Date.now(),
      progress: 0
    });

    jobManager.updateJob(jobId, {
      status: 'cancelled',
      cancelledAt: Date.now()
    });

    return true;
  } catch (error) {
    logger.error(`Error cancelling job ${jobId}:`, error);
    return false;
  }
}

// Eliminar archivos de un job
async function deleteJobFiles(job) {
  let deletedCount = 0;

  // Eliminar archivo de entrada
  if (job.inputPath && fsSync.existsSync(job.inputPath)) {
    try {
      await fs.unlink(job.inputPath);
      logger.info(`✓ Deleted input file: ${job.inputPath}`);
      deletedCount++;
    } catch (err) {
      logger.error(`Failed to delete input file ${job.inputPath}:`, err);
    }
  }

  // Eliminar archivo de salida
  if (job.outputPath && fsSync.existsSync(job.outputPath)) {
    try {
      await fs.unlink(job.outputPath);
      logger.info(`✓ Deleted output file: ${job.outputPath}`);
      deletedCount++;
    } catch (err) {
      logger.error(`Failed to delete output file ${job.outputPath}:`, err);
    }
  }

  return deletedCount;
}

// Limpiar todos los datos de un job
async function cleanupJobCompletely(jobId) {
  const job = jobManager.getJob(jobId);
  if (!job) {
    logger.warn(`Job ${jobId} not found for cleanup`);
    return false;
  }

  try {
    // Eliminar archivos físicos
    await deleteJobFiles(job);

    // Eliminar de Redis
    await redis.del(`job:${jobId}`);

    // Eliminar de jobManager
    jobManager.deleteJob(jobId);

    // Limpiar tracking de descargas
    downloadTracker.delete(jobId);

    logger.info(`✓ Completely cleaned up job ${jobId}`);
    return true;
  } catch (error) {
    logger.error(`Error cleaning up job ${jobId}:`, error);
    return false;
  }
}

// Limpiar todos los jobs de un usuario
async function cleanupUserJobs(userId) {
  const jobs = getUserJobs(userId);

  if (jobs.length === 0) {
    logger.info(`No jobs to clean for user ${userId}`);
    return { cancelled: 0, deleted: 0, total: 0 };
  }

  logger.info(`Cleaning up ${jobs.length} jobs for disconnected user ${userId}`);

  let cancelled = 0;
  let deleted = 0;

  for (const jobId of jobs) {
    const job = jobManager.getJob(jobId);
    if (!job) continue;

    // Cancelar si está en cola o procesándose
    if (job.status === 'queued' || job.status === 'processing') {
      const wasCancelled = await cancelJob(jobId);
      if (wasCancelled) cancelled++;
    }

    // Esperar un momento para que FFmpeg termine de liberar archivos
    await new Promise(resolve => setTimeout(resolve, 500));

    // Eliminar completamente el job
    const wasDeleted = await cleanupJobCompletely(jobId);
    if (wasDeleted) deleted++;
  }

  // Limpiar asociación de jobs del usuario
  userJobs.delete(userId);

  logger.info(`User ${userId} cleanup: ${cancelled} cancelled, ${deleted} deleted (total: ${jobs.length})`);

  return { cancelled, deleted, total: jobs.length };
}

// ===================== LIMPIEZA =====================

const cleanup = async () => {
  try {
    const now = Date.now();
    logger.info('Starting periodic cleanup...');

    // Solo limpiar archivos muy antiguos (1 horas) que no tengan job asociado
    const files = await fs.readdir(dirs.uploads);
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(dirs.uploads, file);
      try {
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > 3600000 && !isFileAssociatedWithJob(filePath)) {
          await fs.unlink(filePath);
          logger.info(`Cleaned old orphan file: ${file}`);
          cleaned++;
        }
      } catch (err) {
        logger.warn(`Error while cleaning file ${filePath}:`, err);
      }
    }

    if (cleaned > 0) {
      logger.info(`Periodic cleanup: removed ${cleaned} old orphan files`);
    }

  } catch (error) {
    logger.error('Cleanup error:', error);
  }
};

setInterval(cleanup, 60000);
cleanup();

// ===================== MANEJO DE ERRORES =====================

app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);

  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File size too large' });
  }

  if (error.message?.includes('Only video and audio files')) {
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// ===================== CIERRE LIMPIO =====================

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful shutdown...');

  server.close(() => {
    logger.info('HTTP server closed');
  });

  await videoQueue.close();
  await redis.quit();

  logger.info('Graceful shutdown completed');
  process.exit(0);
});

// ===================== INICIO DEL SERVIDOR =====================

server.listen(config.port, () => {
  logger.info(`Servidor en ejecución en el puerto ${config.port}`);
  logger.info(`Entorno: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Tamaño máximo de archivo: ${formatSize(config.maxFileSize)}`);
  logger.info(`Máximo de trabajos concurrentes: ${config.maxConcurrentJobs}`);
  logger.info(`Tipo de almacenamiento: ${config.storageType}`);
});

