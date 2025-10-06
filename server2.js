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
const sharp = require("sharp"); // Para procesamiento de imágenes
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
  thumbnails: process.env.THUMBNAILS_DIR || "thumbnails",
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

// Suscribirse a eventos de progreso
subscriber.subscribe('job:progress', (err, count) => {
  if (err) {
    logger.error('Failed to subscribe to job:progress', err);
  }
});

subscriber.on('message', async (channel, message) => {
  if (channel === 'job:progress') {
    const data = JSON.parse(message);

    // Actualizar jobManager local
    jobManager.updateJob(data.jobId, {
      status: 'processing',
      progress: data.progress,
      currentTime: data.currentTime,
      fps: data.fps
    });

    // Emitir a través de Socket.IO
    io.to(data.jobId).emit('job:update', {
      jobId: data.jobId,
      status: 'processing',
      progress: data.progress,
      currentTime: data.currentTime,
      fps: data.fps
    });
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
        reject(err);
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

// Generar miniatura simple
const generateThumbnail = async (videoPath, outputPath, timestamp = '00:00:01') => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timestamp],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '320x240'
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });
};

// Generar varias miniaturas
const generateThumbnailStrip = async (videoPath, outputDir, count = 10) => {
  const info = await getMediaInfo(videoPath);
  const duration = info.duration || 10;
  const interval = duration / count;
  const thumbnails = [];

  for (let i = 0; i < count; i++) {
    const timestamp = i * interval;
    const outputPath = path.join(outputDir, `thumb_${i}.jpg`);

    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [timestamp],
          filename: `thumb_${i}.jpg`,
          folder: outputDir,
          size: '160x120'
        })
        .on('end', () => {
          thumbnails.push(outputPath);
          resolve();
        })
        .on('error', reject);
    });
  }

  return thumbnails;
};

// Calcular métricas de calidad avanzadas
const calculateAdvancedMetrics = async (originalPath, convertedPath) => {
  try {
    const metrics = await calculateQualityMetrics(originalPath, convertedPath);

    // Agregar análisis de cambios de escena
    const sceneCmd = `ffmpeg -i "${convertedPath}" -vf "select='gt(scene,0.4)',showinfo" -f null - 2>&1`;
    const { stdout: sceneOutput } = await execPromise(sceneCmd, { maxBuffer: 10 * 1024 * 1024 });
    const sceneChanges = (sceneOutput.match(/showinfo/g) || []).length;

    // Agregar análisis de vectores de movimiento
    const motionCmd = `ffmpeg -flags2 +export_mvs -i "${convertedPath}" -vf codecview=mv=pf+bf+bb -f null - 2>&1`;

    return {
      ...metrics,
      sceneChanges,
      averageSceneLength: metrics.duration ? metrics.duration / sceneChanges : null
    };
  } catch (error) {
    logger.error('Error calculating advanced metrics:', error);
    return null;
  }
};

// Calcular SSIM, PSNR y VMAF
const calculateQualityMetrics = async (originalPath, convertedPath) => {
  try {
    const vmafModels = [
      '/usr/share/model/vmaf_v0.6.1.json',
      '/usr/local/share/model/vmaf_v0.6.1.json',
      './models/vmaf_v0.6.1.json'
    ];

    let vmafModelPath = null;
    for (const model of vmafModels) {
      if (fsSync.existsSync(model)) {
        vmafModelPath = model;
        break;
      }
    }

    let filterComplex = '[0:v]scale2ref[scaled][ref];[scaled][ref]';
    const metrics = ['ssim=stats_file=ssim.log', 'psnr=stats_file=psnr.log'];

    if (vmafModelPath) {
      metrics.push(`libvmaf=model_path=${vmafModelPath}:log_path=vmaf.log:log_fmt=json`);
    }

    filterComplex += metrics.join(',');

    const cmd = `ffmpeg -i "${convertedPath}" -i "${originalPath}" -lavfi "${filterComplex}" -f null - 2>&1`;

    const { stdout, stderr } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024 });
    const output = stdout + stderr;

    const ssimMatch = output.match(/SSIM.*All:(\d+\.\d+)/);
    const ssimValue = ssimMatch ? parseFloat(ssimMatch[1]) : null;

    const psnrMatch = output.match(/PSNR.*average:(\d+\.\d+)/);
    const psnrValue = psnrMatch ? parseFloat(psnrMatch[1]) : null;

    let vmafValue = null;
    if (vmafModelPath && fsSync.existsSync('vmaf.log')) {
      try {
        const vmafLog = await fs.readFile('vmaf.log', 'utf8');
        const vmafData = JSON.parse(vmafLog);
        if (vmafData.pooled_metrics && vmafData.pooled_metrics.vmaf) {
          vmafValue = vmafData.pooled_metrics.vmaf.mean;
        }
      } catch (e) {
        logger.error('Error parsing VMAF log:', e);
      }
      await fs.unlink('vmaf.log').catch(() => { });
    }

    // Cleanup log files
    ['ssim.log', 'psnr.log'].forEach(async (logFile) => {
      if (fsSync.existsSync(logFile)) {
        await fs.unlink(logFile).catch(() => { });
      }
    });

    return {
      ssim: ssimValue,
      psnr: psnrValue,
      vmaf: vmafValue,
      interpretation: interpretQualityMetrics(ssimValue, psnrValue, vmafValue)
    };

  } catch (error) {
    logger.error('Error calculating quality metrics:', error);
    return {
      ssim: null,
      psnr: null,
      vmaf: null,
      error: error.message
    };
  }
};

const interpretQualityMetrics = (ssim, psnr, vmaf) => {
  const interpretation = {
    overall: 'unknown',
    details: [],
    score: 0
  };

  let scores = [];

  if (ssim !== null) {
    scores.push(ssim * 100);
    if (ssim >= 0.98) {
      interpretation.details.push('SSIM: Excellent (virtually identical)');
    } else if (ssim >= 0.95) {
      interpretation.details.push('SSIM: Very Good (minor differences)');
    } else if (ssim >= 0.88) {
      interpretation.details.push('SSIM: Good (noticeable but acceptable)');
    } else if (ssim >= 0.80) {
      interpretation.details.push('SSIM: Fair (visible degradation)');
    } else {
      interpretation.details.push('SSIM: Poor (significant degradation)');
    }
  }

  if (psnr !== null) {
    scores.push(Math.min(100, psnr * 2.5));
    if (psnr >= 40) {
      interpretation.details.push('PSNR: Excellent quality');
    } else if (psnr >= 35) {
      interpretation.details.push('PSNR: Good quality');
    } else if (psnr >= 30) {
      interpretation.details.push('PSNR: Acceptable quality');
    } else if (psnr >= 25) {
      interpretation.details.push('PSNR: Poor quality');
    } else {
      interpretation.details.push('PSNR: Very poor quality');
    }
  }

  if (vmaf !== null) {
    scores.push(vmaf);
    if (vmaf >= 95) {
      interpretation.details.push('VMAF: Excellent (broadcast quality)');
    } else if (vmaf >= 80) {
      interpretation.details.push('VMAF: Good (streaming quality)');
    } else if (vmaf >= 60) {
      interpretation.details.push('VMAF: Fair (acceptable for mobile)');
    } else {
      interpretation.details.push('VMAF: Poor (noticeable quality loss)');
    }
  }

  if (scores.length > 0) {
    interpretation.score = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (interpretation.score >= 90) interpretation.overall = 'Excellent';
    else if (interpretation.score >= 75) interpretation.overall = 'Good';
    else if (interpretation.score >= 60) interpretation.overall = 'Acceptable';
    else interpretation.overall = 'Poor';
  }

  return interpretation;
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
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
};

// ===================== FUNCIONES DE CONVERSIÓN =====================

const convertVideoWithProgress = async (jobId, inputPath, outputPath, options = {}, bullJob = null) => {
  const {
    preset = 'balanced',
    resolution = null,
    format = 'mp4',
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
    flip = null
  } = options;

  const presetConfig = PRESETS[preset] || PRESETS['balanced'];

  let command = ffmpeg(inputPath);

  // Segmento de video
  if (startTime !== null) {
    command.setStartTime(startTime);
  }
  if (duration !== null) {
    command.setDuration(duration);
  }

  // Filtros de video
  let videoFilters = [];

  // Ajuste de velocidad
  if (speed !== 1.0) {
    videoFilters.push(`setpts=${1 / speed}*PTS`);
    if (!removeAudio) {
      command.audioFilters(`atempo=${speed}`);
    }
  }

  // Reducción de ruido
  if (denoise) {
    videoFilters.push('hqdn3d=4:3:6:4.5');
  }

  // Estabilización
  if (stabilize) {
    videoFilters.push('deshake');
  }

  // Recorte
  if (crop) {
    videoFilters.push(`crop=${crop}`);
  }

  // Rotación
  if (rotate) {
    videoFilters.push(`rotate=${rotate}*PI/180`);
  }

  // Volteo
  if (flip === 'horizontal') {
    videoFilters.push('hflip');
  } else if (flip === 'vertical') {
    videoFilters.push('vflip');
  }

  // Marca de agua
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

  if (videoFilters.length > 0) {
    command.videoFilters(videoFilters);
  }

  // Subtítulos
  if (subtitles && fsSync.existsSync(subtitles)) {
    command.outputOptions(['-vf', `subtitles=${subtitles}`]);
  }

  // Aplicar configuraciones de preset
  if (presetConfig.videoCodec) {
    command.videoCodec(presetConfig.videoCodec);
  }

  // Configuración de audio
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
  }

  // Resolución
  if (resolution || presetConfig.resolution) {
    command.size(resolution || presetConfig.resolution);
  }

  // FPS
  if (presetConfig.fps) {
    command.fps(presetConfig.fps);
  }

  // Opciones de salida
  const outputOptions = [];

  // ===================== FUNCIONES DE CONVERSIÓN (CONTINUACIÓN) =====================

  // Codificación de dos pasos para mejor calidad
  if (twoPass && presetConfig.videoCodec === 'libx264') {
    // Primer paso
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

    // Segundo paso
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

  // Ajustes específicos para ciertos formatos
  if (presetConfig.extraOptions) {
    outputOptions.push(...presetConfig.extraOptions);
  }

  // Agregar opciones personalizadas
  if (customOptions.length > 0) {
    outputOptions.push(...customOptions);
  }

  command.outputOptions(outputOptions);

  // Formato de salida
  command.toFormat(format);

  return new Promise((resolve, reject) => {
    let totalDuration = 0;
    let lastProgress = 0;

    command
      .on('codecData', (data) => {
        totalDuration = parseInt(data.duration.replace(/:/g, ''));
        logger.info(`Job ${jobId} - Total duration: ${data.duration}`);
      })
      // En convertVideoWithProgress, guarda el progreso en Redis
      .on('progress', async (progress) => {
        const currentProgress = Math.min(99, Math.round(progress.percent || 0));

        // Guardar en Redis para que sea accesible desde el servidor principal
        await redis.hset(`job:${jobId}`, {
          status: 'processing',
          progress: currentProgress,
          currentTime: progress.timemark,
          fps: progress.currentFps,
          speed: progress.currentKbps,
          updatedAt: Date.now()
        });

        // Publicar evento para notificar al servidor principal
        await redis.publish('job:progress', JSON.stringify({
          jobId,
          progress: currentProgress,
          currentTime: progress.timemark,
          fps: progress.currentFps
        }));
      })
      .on('end', async () => {
        try {
          // Calcular métricas avanzadas si se requiere
          let metrics = null;
          if (calculateMetrics) {
            metrics = await calculateAdvancedMetrics(inputPath, outputPath);
          }

          // Generar miniatura
          const thumbnailPath = path.join(dirs.thumbnails, `${jobId}.jpg`);
          await generateThumbnail(outputPath, thumbnailPath).catch(err => {
            logger.error(`Failed to generate thumbnail for job ${jobId}:`, err);
          });

          // Obtener info del archivo de salida
          const outputInfo = await getMediaInfo(outputPath);
          const outputStats = await fs.stat(outputPath);

          const result = {
            success: true,
            outputPath,
            thumbnailPath,
            outputSize: outputStats.size,
            outputInfo,
            metrics,
            processingTime: Date.now() - jobManager.getJob(jobId).createdAt
          };

          // Actualizar job en Redis
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

          resolve(result);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', async (err) => {
        logger.error(`Job ${jobId} error:`, err);
        jobManager.updateJob(jobId, {
          status: 'failed',
          error: err.message
        });
        await redis.publish('job:failed', JSON.stringify({
          jobId,
          error: err.message
        }));
        reject(err);
      })
      .save(outputPath);
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
      .filter(line => line.match(/^\s*[DE]/))
      .map(line => {
        const match = line.match(/^\s*([DE]+)\s+(\S+)\s+(.*)/);
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
    res.status(500).json({ error: 'Failed to get formats' });
  }
});

// Obtener códecs soportados
app.get('/api/codecs', async (req, res) => {
  try {
    const { stdout } = await execPromise('ffmpeg -codecs');
    const codecs = stdout.split('\n')
      .filter(line => line.match(/^\s*[DEVASIL]/))
      .map(line => {
        const match = line.match(/^\s*([DEVASIL.]+)\s+(\S+)\s+(.*)/);
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
    res.status(500).json({ error: 'Failed to get codecs' });
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

    // Generar miniatura
    const thumbnailPath = path.join(dirs.thumbnails, `${path.basename(filePath)}.jpg`);
    await generateThumbnail(filePath, thumbnailPath).catch(() => null);

    // Generar tira de miniaturas para vista previa
    const stripDir = path.join(dirs.thumbnails, `strip_${Date.now()}`);
    await fs.mkdir(stripDir, { recursive: true });
    const thumbnailStrip = await generateThumbnailStrip(filePath, stripDir, 10).catch(() => []);

    res.json({
      file: {
        name: req.file.originalname,
        size: req.file.size,
        path: filePath,
        hash
      },
      info,
      thumbnail: thumbnailPath,
      thumbnailStrip: thumbnailStrip.map(t => path.basename(t)),
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

    // Agregar job a la cola de procesamiento
    const bullJob = await videoQueue.add({
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

// Obtener estado de un job
app.get('/api/job/:jobId', (req, res) => {
  const job = jobManager.getJob(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
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

// Obtener miniatura
app.get('/api/thumbnail/:jobId', async (req, res) => {
  const job = jobManager.getJob(req.params.jobId);

  if (!job || !job.result || !job.result.thumbnailPath) {
    return res.status(404).json({ error: 'Thumbnail not found' });
  }

  res.sendFile(path.resolve(job.result.thumbnailPath));
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

// Comparar videos lado a lado
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
  logger.info('Client connected:', socket.id);

  socket.on('subscribe', (jobId) => {
    socket.join(jobId);
    logger.info(`Client ${socket.id} subscribed to job ${jobId}`);

    const job = jobManager.getJob(jobId);
    if (job) {
      socket.emit('job:update', job);
    }
  });

  socket.on('unsubscribe', (jobId) => {
    socket.leave(jobId);
    logger.info(`Client ${socket.id} unsubscribed from job ${jobId}`);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
  });
});

// ===================== LIMPIEZA =====================

const cleanup = async () => {
  try {
    const now = Date.now();
    const retentionTime = config.fileRetentionTime;

    // Lmpiar archivos antiguos
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

  if (error.message && error.message.includes('Only video and audio files')) {
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