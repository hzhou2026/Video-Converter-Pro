const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const helmet = require("helmet");
const winston = require("winston");
const Queue = require("bull");
const Redis = require("ioredis");
const socketIO = require("socket.io");
const http = require("http");

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
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 2000 * 1024 * 1024, // 2GB
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS) || 3,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  enableCache: process.env.ENABLE_CACHE !== 'false',
  enableMetrics: process.env.ENABLE_METRICS !== 'false',
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  storageType: process.env.STORAGE_TYPE || 'local', // 'local' o 's3'
  s3Bucket: process.env.S3_BUCKET,
  cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 3600000, // 1 hora
  fileRetentionTime: parseInt(process.env.FILE_RETENTION) || 10800000, // 3 horas
};

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
  temp: process.env.TEMP_DIR || "temp",
  cache: process.env.CACHE_DIR || "cache"
};

// Crear directorios si no existen
Object.values(dirs).forEach(dir => {
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
});

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

// ===================== GESTIÓN DE TRABAJOS =====================

class JobManager {
  constructor() {
    this.jobs = new Map();
    this.emitter = new EventEmitter();
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

  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      this.emitter.emit('job:updated', job);

      // Emitir a través de Socket.IO
      io.to(jobId).emit('job:update', job);
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
      this.emitter.emit('job:deleted', job);
    }
    return job;
  }
}

const jobManager = new JobManager();

// ===================== PRESETS =====================

const PRESETS = {
  // Presets básicos
  'ultra': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 15,
    preset: 'veryslow',
    audioBitrate: '320k',
    description: 'Ultra quality for archival or professional use'
  },
  'high-quality': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 18,
    preset: 'slow',
    audioBitrate: '256k',
    description: 'High quality for important videos'
  },
  'balanced': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '192k',
    description: 'Balanced quality and file size'
  },
  'fast': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 28,
    preset: 'fast',
    audioBitrate: '128k',
    description: 'Fast processing with acceptable quality'
  },

  // Presets avanzados
  'av1': {
    videoCodec: 'libaom-av1',
    audioCodec: 'opus',
    crf: 30,
    preset: 6,
    audioBitrate: '128k',
    description: 'AV1 codec for maximum compression'
  },
  'hevc': {
    videoCodec: 'libx265',
    audioCodec: 'aac',
    crf: 28,
    preset: 'medium',
    audioBitrate: '128k',
    description: 'H.265/HEVC for better compression than H.264'
  },
  'vp9': {
    videoCodec: 'libvpx-vp9',
    audioCodec: 'opus',
    crf: 31,
    preset: 'good',
    audioBitrate: '128k',
    description: 'VP9 for web compatibility'
  },

  // Presets para redes sociales
  'youtube-4k': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 18,
    preset: 'slow',
    audioBitrate: '256k',
    resolution: '3840x2160',
    fps: 30,
    description: 'Optimized for YouTube 4K uploads',
    extraOptions: ['-movflags', '+faststart', '-pix_fmt', 'yuv420p']
  },
  'youtube-1080p': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '192k',
    resolution: '1920x1080',
    fps: 30,
    description: 'Optimized for YouTube 1080p',
    extraOptions: ['-movflags', '+faststart', '-pix_fmt', 'yuv420p']
  },
  'instagram': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    resolution: '1080x1080',
    fps: 30,
    maxDuration: 60,
    description: 'Square format for Instagram posts',
    extraOptions: ['-movflags', '+faststart']
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
    description: 'Vertical format for Instagram Reels',
    extraOptions: ['-movflags', '+faststart']
  },
  'tiktok': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    resolution: '1080x1920',
    fps: 30,
    maxDuration: 180,
    description: 'Optimized for TikTok',
    extraOptions: ['-movflags', '+faststart']
  },
  'twitter': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 25,
    preset: 'medium',
    audioBitrate: '128k',
    maxSize: '512MB',
    maxDuration: 140,
    description: 'Optimized for Twitter/X',
    extraOptions: ['-movflags', '+faststart']
  },

  // Presets especializados
  'web-streaming': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    description: 'Optimized for web streaming',
    extraOptions: [
      '-movflags', '+faststart',
      '-profile:v', 'main',
      '-level', '4.0',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0'
    ]
  },
  'hls': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    description: 'HLS streaming format',
    outputFormat: 'hls',
    extraOptions: [
      '-hls_time', '10',
      '-hls_list_size', '0',
      '-hls_segment_filename', 'segment_%03d.ts'
    ]
  },
  'gif': {
    description: 'Convert to animated GIF',
    outputFormat: 'gif',
    fps: 10,
    resolution: '480x?',
    extraOptions: [
      '-vf', 'fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse'
    ]
  },
  'mobile': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 28,
    preset: 'fast',
    audioBitrate: '96k',
    resolution: '720x?',
    description: 'Optimized for mobile devices',
    extraOptions: ['-profile:v', 'baseline', '-level', '3.0']
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

function buildVideoFilters({ speed, removeAudio, denoise, stabilize, crop, rotate, flip, watermark }) {
  const videoFilters = [];

  if (speed !== 1.0) {
    videoFilters.push(`setpts=${1 / speed}*PTS`);
  }
  if (denoise) {
    videoFilters.push('hqdn3d=4:3:6:4.5');
  }
  if (stabilize) {
    videoFilters.push('deshake');
  }
  if (crop) {
    videoFilters.push(`crop=${crop}`);
  }
  if (rotate) {
    videoFilters.push(`rotate=${rotate}*PI/180`);
  }
  if (flip === 'horizontal') {
    videoFilters.push('hflip');
  } else if (flip === 'vertical') {
    videoFilters.push('vflip');
  }
  if (watermark && fsSync.existsSync(watermark.path)) {
    const position = watermark.position || 'bottomright';
    const positions = {
      topleft: 'x=10:y=10',
      topright: 'x=W-w-10:y=10',
      bottomleft: 'x=10:y=H-h-10',
      bottomright: 'x=W-w-10:y=H-h-10',
      center: 'x=(W-w)/2:y=(H-h)/2'
    };
    videoFilters.push(`movie=${watermark.path}[watermark];[in][watermark]overlay=${positions[position]}[out]`);
  }
  return videoFilters;
}

function applyAudioOptions(command, { removeAudio, presetConfig, normalizeAudio, speed }) {
  if (removeAudio) {
    command.noAudio();
  } else if (presetConfig.audioCodec) {
    command.audioCodec(presetConfig.audioCodec);
    if (presetConfig.audioBitrate) {
      command.audioBitrate(presetConfig.audioBitrate);
    }
    if (normalizeAudio) {
      command.audioFilters('loudnorm=I=-16:TP=-1.5:LRA=11');
    }
    if (speed !== 1.0) {
      command.audioFilters(`atempo=${speed}`);
    }
  }
}

function buildOutputOptions({ twoPass, presetConfig, jobId, customOptions }) {
  const outputOptions = [];
  if (twoPass && presetConfig.videoCodec === 'libx264') {
    outputOptions.push(
      `-pass`, `2`,
      `-passlogfile`, path.join(dirs.temp, `pass_${jobId}`)
    );
  }
  if (presetConfig.crf) {
    outputOptions.push(`-crf`, `${presetConfig.crf}`);
  }
  if (presetConfig.preset) {
    outputOptions.push(`-preset`, `${presetConfig.preset}`);
  }
  if (presetConfig.extraOptions) {
    outputOptions.push(...presetConfig.extraOptions);
  }
  if (customOptions.length > 0) {
    outputOptions.push(...customOptions);
  }
  return outputOptions;
}

async function runTwoPass(inputPath, presetConfig, jobId) {
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .outputOptions([
        `-pass`, `1`,
        `-crf`, `${presetConfig.crf}`,
        `-preset`, `${presetConfig.preset}`,
        `-passlogfile`, path.join(dirs.temp, `pass_${jobId}`),
        `-f`, `null`
      ])
      .output('/dev/null')
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

function handleProgress(jobId, progress) {
  const currentProgress = Math.min(99, Math.round(progress.percent || 0));
  return redis.hset(`job:${jobId}`, {
    status: 'processing',
    progress: currentProgress,
    currentTime: progress.timemark,
    fps: progress.currentFps,
    speed: progress.currentKbps,
    updatedAt: Date.now()
  }).then(() =>
    redis.publish('job:progress', JSON.stringify({
      jobId,
      progress: currentProgress,
      currentTime: progress.timemark,
      fps: progress.currentFps
    }))
  );
}

async function handleEnd({ jobId, inputPath, outputPath, calculateMetrics }) {
  let metrics = null;
  if (calculateMetrics) {
    metrics = await calculateAdvancedMetrics(inputPath, outputPath);
  }
  const outputInfo = await getMediaInfo(outputPath);
  const outputStats = await fs.stat(outputPath);

  const result = {
    success: true,
    outputPath,
    outputSize: outputStats.size,
    outputInfo,
    metrics,
    processingTime: Date.now() - jobManager.getJob(jobId).createdAt
  };

  await redis.publish('job:completed', JSON.stringify({
    jobId,
    result
  }));

  jobManager.updateJob(jobId, {
    status: 'completed',
    progress: 100,
    result,
    completedAt: Date.now()
  });

  return result;
}

async function handleError(jobId, err) {
  logger.error(`Job ${jobId} error:`, err);
  jobManager.updateJob(jobId, {
    status: 'failed',
    error: err?.message ?? String(err)
  });
  await redis.publish('job:failed', JSON.stringify({
    jobId,
    error: err?.message ?? String(err)
  }));
  let errorObj;
  if (err instanceof Error) {
    errorObj = err;
  } else {
    errorObj = new Error(`Job ${jobId} failed: ${err?.message ?? String(err)}`);
  }
  throw errorObj;
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

// Convertir timemark (HH:MM:SS.mmm) a segundos
function timemarkToSeconds(timemark) {
  if (!timemark || timemark === 'N/A' || timemark === '00:00:00.00') return 0;

  // Manejar timemarks negativos
  const isNegative = timemark.startsWith('-');
  const cleanTimemark = timemark.replace('-', '');

  try {
    const parts = cleanTimemark.split(':');
    if (parts.length !== 3) return 0;

    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;

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

// ===================== CONVERSIÓN CON PROGRESO MEJORADO =====================

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
        `Speed: ${
          progress.currentKbps
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

const convertVideoWithProgress = async (
  jobId,
  inputPath,
  outputPath,
  options = {},
  bullJob = null
) => {
  const {
    preset = "balanced",
    resolution = null,
    format = "mp4",
    startTime = null,
    duration = null,
    removeAudio = false,
    customOptions = [],
    calculateMetrics = false,
    watermark = null,
    subtitles = null,
    twoPass = false,
    normalizeAudio = false,
    denoise = false,
    stabilize = false,
    speed = 1.0,
    crop = null,
    rotate = null,
    flip = null,
  } = options;

  // Variables de progreso
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

  let totalDuration;
  try {
    totalDuration = await getValidatedDuration(inputPath, startTime, duration, jobId);
  } catch (error) {
    logger.error(`Job ${jobId} - Failed to get video duration:`, error);
    await redis.hset(`job:${jobId}`, {
      status: "failed",
      error: `Failed to read input file: ${error.message}`,
    });
    jobManager.updateJob(jobId, {
      status: "failed",
      error: `Failed to read input file: ${error.message}`,
    });
    await redis.publish(
      "job:failed",
      JSON.stringify({
        jobId,
        error: `Failed to read input file: ${error.message}`,
      })
    );
    throw new Error(`Cannot process video: ${error.message}`);
  }

  const presetConfig = PRESETS[preset] || PRESETS["balanced"];
  let command = ffmpeg(inputPath);

  // Aplicar opciones al comando
  function applyCommandOptions(command) {
    if (startTime !== null) command.setStartTime(startTime);
    if (duration !== null) command.setDuration(duration);
    const videoFilters = buildVideoFilters({
      speed,
      removeAudio,
      denoise,
      stabilize,
      crop,
      rotate,
      flip,
      watermark,
    });
    if (videoFilters.length > 0) command.videoFilters(videoFilters);
    if (subtitles && fsSync.existsSync(subtitles)) {
      command.outputOptions(["-vf", `subtitles=${subtitles}`]);
    }
    if (presetConfig.videoCodec) command.videoCodec(presetConfig.videoCodec);
    applyAudioOptions(command, {
      removeAudio,
      presetConfig,
      normalizeAudio,
      speed,
    });
    if (resolution || presetConfig.resolution) {
      command.size(resolution || presetConfig.resolution);
    }
    if (presetConfig.fps) command.fps(presetConfig.fps);
    const outputOptions = buildOutputOptions({
      twoPass,
      presetConfig,
      jobId,
      customOptions,
    });
    command.outputOptions(outputOptions);
    command.toFormat(format);
  }

  applyCommandOptions(command);

  if (twoPass && presetConfig.videoCodec === "libx264") {
    try {
      await runTwoPass(inputPath, presetConfig, jobId);
    } catch (error) {
      logger.warn(
        `Two-pass encoding failed, continuing with single pass:`,
        error.message
      );
    }
  }

  // Finalizar trabajo
  async function finalizeJob({
    jobId,
    startTimeMs,
    inputPath,
    outputPath,
    calculateMetrics,
    resolve,
    totalDuration,
  }) {
    if (progressUpdateInterval) clearInterval(progressUpdateInterval);
    const totalTime = Math.round((Date.now() - startTimeMs) / 1000);
    logger.info(
      `Job ${jobId} - Encoding completed in ${formatDuration(totalTime)}`
    );
    let metrics = null;
    if (calculateMetrics) {
      logger.info(`Job ${jobId} - Calculating quality metrics...`);
      try {
        metrics = await calculateAdvancedMetrics(inputPath, outputPath);
      } catch (err) {
        logger.warn(`Failed to calculate metrics:`, err.message);
      }
    }
    const outputInfo = await getMediaInfo(outputPath);
    const outputStats = await fs.stat(outputPath);
    const processingTime = Date.now() - jobManager.getJob(jobId).createdAt;
    const result = {
      success: true,
      outputPath,
      outputSize: outputStats.size,
      outputSizeFormatted: formatSize(outputStats.size),
      outputInfo,
      metrics,
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
    await redis.publish(
      "job:completed",
      JSON.stringify({
        jobId,
        result,
      })
    );
    io.to(jobId).emit("job:update", {
      id: jobId,
      jobId: jobId,
      status: "completed",
      progress: 100,
      result,
    });
    logger.info(
      `Job ${jobId} completed successfully in ${formatDuration(
        totalTime
      )}`
    );
    resolve(result);
  }

  // Manejar errores del trabajo
  async function handleJobErrorWrapper(jobId, err, reject) {
    if (progressUpdateInterval) clearInterval(progressUpdateInterval);
    await handleJobError(jobId, err, redis, jobManager, io, reject);
  }

  let progressUpdateInterval = null;
  return new Promise((resolve, reject) => {
    let lastProgress = -1;
    let lastLoggedProgress = -1;
    const startTimeMs = Date.now();

    command
      .on("progress", async (progress) => {
        try {
          const result = handleProgressEvent({
            jobId,
            progress,
            totalDuration,
            lastProgress,
            lastLoggedProgress,
            startTime: startTimeMs,
            redis,
            jobManager,
            io,
          });
          lastProgress = result.lastProgress;
          lastLoggedProgress = result.lastLoggedProgress;
        } catch (error) {
          logger.error(`Error updating progress for job ${jobId}:`, error);
        }
      })
      .on("end", async () => {
        try {
          await finalizeJob({
            jobId,
            startTimeMs,
            inputPath,
            outputPath,
            calculateMetrics,
            resolve,
            totalDuration,
          });
        } catch (error) {
          logger.error(`Error finalizing job ${jobId}:`, error);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })
      .on("error", async (err) => {
        try {
          await handleJobErrorWrapper(jobId, err, reject);
        } catch (error) {
          logger.error(`Error handling job ${jobId} failure:`, error);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })
      .save(outputPath);

    progressUpdateInterval = setInterval(async () => {
      try {
        const jobData = await redis.hgetall(`job:${jobId}`);
        if (jobData && jobData.status === "processing") {
          const lastUpdate = parseInt(jobData.updatedAt || 0);
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
        logger.error(
          `Error in progress interval for job ${jobId}:`,
          error
        );
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
          progress: parseInt(jobData.progress || 0),
          currentTime: jobData.currentTime,
          fps: parseFloat(jobData.fps || 0),
          speed: jobData.speed,
          error: jobData.error,
          result: jobData.result ? JSON.parse(jobData.result) : null,
          createdAt: parseInt(jobData.createdAt || Date.now()),
          updatedAt: parseInt(jobData.updatedAt || Date.now())
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
  } catch (error) {
    logger.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze media', details: error.message });
  }
});

// Sugerir configuraciones óptimas basadas en el análisis
const suggestOptimalSettings = (info) => {
  const suggestions = [];

  if (info.video) {
    // Sugerencias de resolución
    if (info.video.width >= 3840) {
      suggestions.push({
        type: 'resolution',
        message: 'Video 4k. Considerar ajustar a 1080p para la mayoría de los usos.',
        preset: 'youtube-1080p'
      });
    }

    // Sugerencias de codec
    if (info.video.codec === 'h264') {
      suggestions.push({
        type: 'codec',
        message: 'Video en H.264. Considerar H.265/HEVC para mejor compresión.',
        preset: 'hevc'
      });
    }

    // Sugerencias de FPS
    if (info.video.fps > 30) {
      suggestions.push({
        type: 'fps',
        message: `Se ha detectado una alta tasa de fotogramas (${info.video.fps}fps). Considerar 30/60fps para reducir el tamaño del archivo.`,
        option: { fps: 30 }
      });
    }
  }

  if (info.audio) {
    // Sugerencias de bitrate de audio
    if (info.audio.bitrate > 256000) {
      suggestions.push({
        type: 'audio',
        message: 'Se ha detectado un alto bitrate de audio. 192kbps es suficiente para la mayoría de los casos de uso.',
        option: { audioBitrate: '192k' }
      });
    }
  }

  // Sugerencias de tamaño de archivo
  if (info.size > 1024 * 1024 * 1024) { // > 1GB
    suggestions.push({
      type: 'size',
      message: 'Se ha detectado un archivo grande. Considerar usar el preset "balanced" o "fast".',
      preset: 'balanced'
    });
  }

  return suggestions;
};

// Conversión de video/audio
app.post('/api/convert', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const {
      preset = 'balanced',
      format = 'mp4',
      resolution,
      startTime,
      duration,
      removeAudio,
      calculateMetrics,
      watermark,
      subtitles,
      twoPass,
      normalizeAudio,
      denoise,
      stabilize,
      speed,
      crop,
      rotate,
      flip,
      customOptions = []
    } = req.body;

    const inputPath = req.file.path;
    const outputFilename = `${path.parse(req.file.filename).name}_converted.${format}`;
    const outputPath = path.join(dirs.outputs, outputFilename);

    // Crear job
    const job = jobManager.createJob({
      type: 'conversion',
      inputPath,
      outputPath,
      inputName: req.file.originalname,
      outputName: outputFilename,
      options: req.body,
      userId: req.headers['x-user-id'] || 'anonymous'
    });

    logger.info(`Job created: ${job.id} for file: ${req.file.originalname}`);

    // Guardar en Redis
    await redis.hset(`job:${job.id}`, {
      status: 'queued',
      progress: 0,
      inputName: req.file.originalname,
      outputName: outputFilename,
      createdAt: Date.now()
    });

    // Agregar job a la cola de procesamiento
    await videoQueue.add({
      jobId: job.id,
      inputPath,
      outputPath,
      options: {
        preset,
        format,
        resolution,
        startTime: startTime ? parseFloat(startTime) : null,
        duration: duration ? parseFloat(duration) : null,
        removeAudio: removeAudio === 'true',
        calculateMetrics: calculateMetrics === 'true',
        watermark,
        subtitles,
        twoPass: twoPass === 'true',
        normalizeAudio: normalizeAudio === 'true',
        denoise: denoise === 'true',
        stabilize: stabilize === 'true',
        speed: speed ? parseFloat(speed) : 1.0,
        crop,
        rotate: rotate ? parseFloat(rotate) : null,
        flip,
        customOptions: Array.isArray(customOptions) ? customOptions : []
      }
    });

    res.json({
      jobId: job.id,
      status: 'queued',
      inputName: req.file.originalname,
      outputName: outputFilename,
      message: 'Video conversion job created successfully'
    });

  } catch (error) {
    logger.error('Conversion error:', error);
    res.status(500).json({ error: 'Failed to start conversion', details: error.message });
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
    const bullJob = await videoQueue.getJob(jobId);
    if (bullJob) {
      await bullJob.remove();
    }

    jobManager.updateJob(jobId, {
      status: 'cancelled',
      cancelledAt: Date.now()
    });

    res.json({ message: 'Job cancelled successfully' });
  } catch (error) {
    logger.error('Cancel job error:', error);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

// Descargar archivo convertido
app.get('/api/download/:jobId', async (req, res) => {
  const job = jobManager.getJob(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Job not completed yet' });
  }

  if (!fsSync.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Output file not found' });
  }

  res.download(job.outputPath, job.outputName);
});

// Transmitir video convertido
app.get('/api/stream/:jobId', async (req, res) => {
  const job = jobManager.getJob(req.params.jobId);

  if (!job || job.status !== 'completed') {
    return res.status(404).json({ error: 'Video not available' });
  }

  const videoPath = job.outputPath;
  const stat = await fs.stat(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
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

// Comparar videos
app.post('/api/compare', async (req, res) => {
  try {
    const { originalJobId, convertedJobId } = req.body;

    const originalJob = jobManager.getJob(originalJobId);
    const convertedJob = jobManager.getJob(convertedJobId);

    if (!originalJob || !convertedJob) {
      return res.status(404).json({ error: 'Jobs not found' });
    }

    const metrics = await calculateAdvancedMetrics(
      originalJob.inputPath || originalJob.outputPath,
      convertedJob.outputPath
    );

    const originalInfo = await getMediaInfo(originalJob.inputPath || originalJob.outputPath);
    const convertedInfo = await getMediaInfo(convertedJob.outputPath);

    const originalStats = await fs.stat(originalJob.inputPath || originalJob.outputPath);
    const convertedStats = await fs.stat(convertedJob.outputPath);

    res.json({
      original: {
        info: originalInfo,
        size: originalStats.size,
        sizeFormatted: formatSize(originalStats.size)
      },
      converted: {
        info: convertedInfo,
        size: convertedStats.size,
        sizeFormatted: formatSize(convertedStats.size)
      },
      comparison: {
        sizeReduction: ((1 - convertedStats.size / originalStats.size) * 100).toFixed(2) + '%',
        metrics
      }
    });

  } catch (error) {
    logger.error('Comparison error:', error);
    res.status(500).json({ error: 'Failed to compare videos' });
  }
});

// ===================== SOCKET.IO =====================

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('subscribe', async (jobId) => {
    try {
      socket.join(jobId);
      logger.info(`Client ${socket.id} subscribed to job ${jobId}`);

      // Enviar estado actual del job inmediatamente
      const job = jobManager.getJob(jobId);
      if (job) {
        socket.emit('job:update', {
          id: job.id,
          jobId: job.id,
          ...job
        });
      } else {
        // Intentar obtener de Redis si no está en jobManager
        const jobData = await redis.hgetall(`job:${jobId}`);
        if (jobData && Object.keys(jobData).length > 0) {
          socket.emit('job:update', {
            id: jobId,
            jobId: jobId,
            status: jobData.status,
            progress: parseInt(jobData.progress || 0),
            currentTime: jobData.currentTime,
            fps: parseFloat(jobData.fps || 0),
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

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// ===================== LIMPIEZA =====================

const cleanup = async () => {
  try {
    const now = Date.now();
    const retentionTime = config.fileRetentionTime;

    // Limpiar archivos antiguos
    for (const dir of [dirs.uploads, dirs.outputs, dirs.temp]) {
      const files = await fs.readdir(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtimeMs > retentionTime) {
          await fs.unlink(filePath);
          logger.info(`Cleaned up old file: ${filePath}`);
        }
      }
    }

    // Limpiar jobs antiguos
    const jobs = jobManager.getAllJobs();
    for (const job of jobs) {
      if ((job.status === 'completed' || job.status === 'failed') &&
        now - (job.completedAt || job.createdAt) > retentionTime) {
        jobManager.deleteJob(job.id);
        logger.info(`Cleaned up job: ${job.id}`);
      }
    }

  } catch (error) {
    logger.error('Cleanup error:', error);
  }
};

// Ejecutar limpieza periódica
setInterval(cleanup, config.cleanupInterval);

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

