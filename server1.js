const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");

const app = express();

// Activar CORS para la integración con el frontend
app.use(cors());
app.use(express.json());

// Crear directorios si no existen
const uploadsDir = "uploads";
const outputsDir = "outputs";
const tempDir = "temp";

[uploadsDir, outputsDir, tempDir].forEach(dir => {
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
});

// Guardar trabajos activos en memoria
const activeJobs = new Map();

// Estado de eventos para actualizaciones en tiempo real
class JobEmitter extends EventEmitter {}
const jobEmitter = new JobEmitter();

// Videopresets predefinidos
const PRESETS = {
  // H.264 Presets
  'high-quality': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 18,
    preset: 'slow',
    audioBitrate: '256k',
    description: 'Máxima calidad H.264, archivos grandes'
  },
  'balanced': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '192k',
    description: 'Balance óptimo calidad/tamaño'
  },
  'fast': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 28,
    preset: 'fast',
    audioBitrate: '128k',
    description: 'Conversión rápida, menor calidad'
  },
  'web-optimized': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    extraOptions: ['-movflags', '+faststart', '-profile:v', 'main', '-level', '4.0'],
    description: 'Optimizado para streaming web'
  },
  
  // H.265/HEVC Presets
  'hevc-high': {
    videoCodec: 'libx265',
    audioCodec: 'aac',
    crf: 20,
    preset: 'slow',
    audioBitrate: '256k',
    description: 'H.265 alta calidad, mejor compresión que H.264'
  },
  'hevc-balanced': {
    videoCodec: 'libx265',
    audioCodec: 'aac',
    crf: 25,
    preset: 'medium',
    audioBitrate: '192k',
    description: 'H.265 equilibrado'
  },
  'hevc-fast': {
    videoCodec: 'libx265',
    audioCodec: 'aac',
    crf: 28,
    preset: 'fast',
    audioBitrate: '128k',
    description: 'H.265 conversión rápida'
  },
  
  // AV1 Presets
  'av1-high': {
    videoCodec: 'libaom-av1',
    audioCodec: 'opus',
    crf: 25,
    preset: 4,
    audioBitrate: '192k',
    description: 'AV1 alta calidad, compresión excelente, muy lento'
  },
  'av1-balanced': {
    videoCodec: 'libaom-av1',
    audioCodec: 'opus',
    crf: 30,
    preset: 6,
    audioBitrate: '128k',
    description: 'AV1 equilibrado, buena compresión'
  },
  'av1-fast': {
    videoCodec: 'libaom-av1',
    audioCodec: 'opus',
    crf: 35,
    preset: 8,
    audioBitrate: '128k',
    description: 'AV1 rápido (aunque sigue siendo lento)'
  },
  
  // VP9 Presets
  'vp9-high': {
    videoCodec: 'libvpx-vp9',
    audioCodec: 'opus',
    crf: 20,
    preset: 'good',
    audioBitrate: '192k',
    extraOptions: ['-row-mt', '1', '-tile-columns', '2'],
    description: 'VP9 alta calidad, buen balance'
  },
  'vp9-balanced': {
    videoCodec: 'libvpx-vp9',
    audioCodec: 'opus',
    crf: 31,
    preset: 'good',
    audioBitrate: '128k',
    extraOptions: ['-row-mt', '1', '-tile-columns', '2'],
    description: 'VP9 equilibrado'
  },
  
  // VP8 Presets
  'vp8-web': {
    videoCodec: 'libvpx',
    audioCodec: 'opus',
    crf: 10,
    preset: 'good',
    audioBitrate: '128k',
    description: 'VP8 para web (WebM)'
  },
  
  // Theora Preset (libre y antiguo)
  'theora': {
    videoCodec: 'libtheora',
    audioCodec: 'opus',
    crf: 7,
    preset: null,
    audioBitrate: '192k',
    description: 'Theora (formato libre, poco usado)'
  },
  
  // Presets específicos por uso
  'archive-quality': {
    videoCodec: 'libx264',
    audioCodec: 'flac',
    crf: 0,
    preset: 'veryslow',
    audioBitrate: null,
    extraOptions: ['-qp', '0'],
    description: 'Archivado sin pérdida (H.264 lossless + FLAC)'
  },
  'social-media': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'fast',
    audioBitrate: '128k',
    extraOptions: ['-movflags', '+faststart', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p'],
    description: 'Optimizado para redes sociales (Instagram, Twitter, etc.)'
  },
  'youtube-1080p': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 21,
    preset: 'slow',
    audioBitrate: '192k',
    extraOptions: ['-movflags', '+faststart', '-profile:v', 'high', '-bf', '2', '-g', '30'],
    description: 'Optimizado para YouTube 1080p'
  },
  'animation': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 18,
    preset: 'slow',
    audioBitrate: '192k',
    extraOptions: ['-tune', 'animation'],
    description: 'Optimizado para contenido animado'
  },
  'screen-recording': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 18,
    preset: 'ultrafast',
    audioBitrate: '192k',
    extraOptions: ['-tune', 'zerolatency'],
    description: 'Para grabaciones de pantalla'
  },
  
  // Presets de baja resolución/móvil
  'mobile-low': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 28,
    preset: 'veryfast',
    audioBitrate: '96k',
    extraOptions: ['-profile:v', 'baseline', '-level', '3.0'],
    description: 'Móviles de gama baja, archivos pequeños'
  },
  'mobile-high': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    crf: 23,
    preset: 'medium',
    audioBitrate: '128k',
    extraOptions: ['-profile:v', 'main', '-level', '4.0'],
    description: 'Móviles modernos'
  }
};

// Configuración de Multer para subir archivos
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limite
  },
  fileFilter: (req, file, cb) => {
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.hevc', '.h265', 
                            '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.ogv', '.mts', '.m2ts'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (file.mimetype.startsWith('video/') || 
        file.mimetype.startsWith('audio/') || 
        videoExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de video y audio'), false);
    }
  }
});

// Manejo de errores de Multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Archivo demasiado grande (máx 500MB)' });
    }
    return res.status(400).json({ error: error.message });
  }

  if (error.message === 'Solo se permiten archivos de video y audio') {
    return res.status(400).json({ error: error.message });
  }
  
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Limpiar archivos temporales
const cleanupFiles = async (...filePaths) => {
  const cleanupPromises = filePaths.map(async (filePath) => {
    if (filePath && fsSync.existsSync(filePath)) {
      try {
        await fs.unlink(filePath);
        console.log('Limpiar archivos temporales:', filePath);
      } catch (err) {
        console.error('Error al eliminar el archivo:', filePath, err);
      }
    }
  });
  
  await Promise.all(cleanupPromises);
};

// Obtener información del archivo multimedia
const getMediaInfo = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
        
        resolve({
          duration: metadata.format.duration,
          size: metadata.format.size,
          bitrate: metadata.format.bit_rate,
          format: metadata.format.format_name,
          video: videoStream ? {
            codec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            fps: eval(videoStream.r_frame_rate),
            bitrate: videoStream.bit_rate
          } : null,
          audio: audioStream ? {
            codec: audioStream.codec_name,
            channels: audioStream.channels,
            sampleRate: audioStream.sample_rate,
            bitrate: audioStream.bit_rate
          } : null
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

// Función principal de conversión
const convertVideo = async (jobId, inputPath, outputPath, options = {}) => {
  const {
    preset = 'balanced',
    resolution = null,
    format = 'mp4',
    startTime = null,
    duration = null,
    removeAudio = false,
    customOptions = []
  } = options;

  const presetConfig = PRESETS[preset] || PRESETS['balanced'];
  const job = activeJobs.get(jobId);
  
  let command = ffmpeg(inputPath);

  // Aplicar configuración de video
  if (presetConfig.videoCodec) {
    command.videoCodec(presetConfig.videoCodec);
  }

  // Aplicar configuración de audio
  if (removeAudio) {
    command.noAudio();
  } else if (presetConfig.audioCodec) {
    command.audioCodec(presetConfig.audioCodec);
    if (presetConfig.audioBitrate) {
      command.audioBitrate(presetConfig.audioBitrate);
    }
  }

  // Aplicar resolución si se especifica
  if (resolution) {
    command.size(resolution);
  }

  // Aplicar rango de tiempo si se especifica
  if (startTime !== null) {
    command.setStartTime(startTime);
  }
  if (duration !== null) {
    command.setDuration(duration);
  }

  // Aplicar configuración de calidad
  const outputOptions = [];
  
  if (presetConfig.videoCodec === 'libaom-av1') {
    outputOptions.push(`-crf ${presetConfig.crf}`);
    outputOptions.push(`-cpu-used ${presetConfig.preset}`);
    outputOptions.push('-row-mt 1'); // Activar multi-threading
  } else if (presetConfig.videoCodec === 'libx264') {
    outputOptions.push(`-crf ${presetConfig.crf}`);
    outputOptions.push(`-preset ${presetConfig.preset}`);
  }

  // Agregar opciones adicionales del preset
  if (presetConfig.extraOptions) {
    outputOptions.push(...presetConfig.extraOptions);
  }

  // Agregar opciones personalizadas
  outputOptions.push(...customOptions);

  // Siempre agregar movflags para mp4
  if (!outputOptions.some(opt => opt.includes('movflags'))) {
    outputOptions.push('-movflags +faststart');
  }

  command.outputOptions(outputOptions);

  return new Promise((resolve, reject) => {
    command
      .on("start", (commandLine) => {
        console.log('FFmpeg process started for job:', jobId);
        console.log('Command:', commandLine);
        if (job) {
          job.status = 'processing';
          job.startTime = Date.now();
        }
      })
      .on("progress", (progress) => {
        if (job) {
          job.progress = Math.round(progress.percent) || 0;
          job.currentTime = progress.timemark;
          jobEmitter.emit('progress', { jobId, progress: job.progress });
        }
        console.log(`Job ${jobId}: ${job?.progress}% done`);
      })
      .on("end", async () => {
        console.log(`Conversion completed for job: ${jobId}`);
        
        try {
          // Obtener estadísticas del archivo de salida
          const stats = await fs.stat(outputPath);
          const mediaInfo = await getMediaInfo(outputPath);
          
          if (job) {
            job.status = 'completed';
            job.progress = 100;
            job.endTime = Date.now();
            job.outputSize = stats.size;
            job.outputInfo = mediaInfo;
            jobEmitter.emit('completed', { jobId });
          }
          
          resolve({
            success: true,
            outputPath,
            size: stats.size,
            info: mediaInfo
          });
        } catch (error) {
          reject(error);
        }
      })
      .on("error", (err) => {
        console.error(`FFmpeg error for job ${jobId}:`, err);
        if (job) {
          job.status = 'failed';
          job.error = err.message;
          jobEmitter.emit('error', { jobId, error: err.message });
        }
        reject(err);
      })
      .save(outputPath);
  });
};

// API rutas

// Obtener presets disponibles
app.get("/presets", (req, res) => {
  const presetInfo = Object.entries(PRESETS).map(([name, config]) => ({
    name,
    description: getPresetDescription(name),
    config: {
      videoCodec: config.videoCodec,
      audioCodec: config.audioCodec,
      quality: config.crf
    }
  }));
  
  res.json(presetInfo);
});

function getPresetDescription(preset) {
  return PRESETS[preset]?.description || 'Preset personalizado';
}

// Principal endpoint de conversión
app.post("/convert", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se subió ningún archivo" });
  }

  const jobId = uuidv4();
  const inputPath = req.file.path;
  
  try {
    // Obtener información del archivo de entrada
    const inputInfo = await getMediaInfo(inputPath);

    // Analizar opciones de conversión
    const {
      preset = 'balanced',
      resolution = null,
      format = 'mp4',
      startTime = null,
      duration = null,
      removeAudio = false
    } = req.body;

    const outputFilename = `${jobId}-converted.${format}`;
    const outputPath = path.join(outputsDir, outputFilename);

    // Crear objeto de Job
    const job = {
      id: jobId,
      status: 'pending',
      progress: 0,
      inputFile: req.file.originalname,
      inputSize: req.file.size,
      inputInfo,
      outputFile: outputFilename,
      preset,
      options: { resolution, format, startTime, duration, removeAudio },
      createdAt: Date.now()
    };

    activeJobs.set(jobId, job);

    // Empezar conversión asincrónica
    convertVideo(jobId, inputPath, outputPath, {
      preset,
      resolution,
      format,
      startTime,
      duration,
      removeAudio
    }).then(async (result) => {
      // Conversión exitosa
      job.downloadUrl = `/download/${jobId}`;
      console.log(`Job ${jobId} completed successfully`);
    }).catch(async (error) => {
      // Conversión fallida
      console.error(`Job ${jobId} failed:`, error);
      await cleanupFiles(inputPath, outputPath);
    });

    // Devolver respuesta inicial con jobId
    res.json({
      jobId,
      status: 'processing',
      message: 'Conversion started',
      inputInfo: {
        filename: req.file.originalname,
        size: formatSize(req.file.size),
        duration: inputInfo.duration ? `${Math.round(inputInfo.duration)}s` : 'unknown',
        resolution: inputInfo.video ? `${inputInfo.video.width}x${inputInfo.video.height}` : 'unknown'
      }
    });

  } catch (error) {
    console.error('Error processing request:', error);
    await cleanupFiles(inputPath);
    res.status(500).json({ error: 'Failed to process file', details: error.message });
  }
});

// Extracción de audio a MP3
app.post("/extract-audio", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Archivo no subido" });
  }

  const jobId = uuidv4();
  const inputPath = req.file.path;
  const { format = 'mp3', bitrate = '192k' } = req.body;
  
  const outputFilename = `${jobId}-audio.${format}`;
  const outputPath = path.join(outputsDir, outputFilename);

  try {
    const inputInfo = await getMediaInfo(inputPath);
    
    if (!inputInfo.audio) {
      await cleanupFiles(inputPath);
      return res.status(400).json({ error: 'No se encontró flujo de audio en el archivo' });
    }

    const job = {
      id: jobId,
      type: 'audio-extraction',
      status: 'processing',
      progress: 0,
      inputFile: req.file.originalname,
      outputFile: outputFilename,
      createdAt: Date.now()
    };

    activeJobs.set(jobId, job);

    ffmpeg(inputPath)
      .noVideo()
      .audioCodec(format === 'mp3' ? 'libmp3lame' : 'aac')
      .audioBitrate(bitrate)
      .on("progress", (progress) => {
        job.progress = Math.round(progress.percent) || 0;
      })
      .on("end", async () => {
        job.status = 'completed';
        job.downloadUrl = `/download/${jobId}`;
        
        res.json({
          jobId,
          status: 'completed',
          downloadUrl: job.downloadUrl,
          format,
          bitrate
        });
        
        // 1 hora después de la finalización, limpiar archivos
        setTimeout(() => cleanupFiles(inputPath, outputPath), 3600000);
      })
      .on("error", async (err) => {
        job.status = 'failed';
        job.error = err.message;
        await cleanupFiles(inputPath, outputPath);
        res.status(500).json({ error: 'Extracción de audio fallida', details: err.message });
      })
      .save(outputPath);

  } catch (error) {
    console.error('Error extracting audio:', error);
    await cleanupFiles(inputPath);
    res.status(500).json({ error: 'Error al procesar el archivo', details: error.message });
  }
});

// Estado del JOB
app.get("/job/:jobId", (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job no encontrado' });
  }

  const response = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    inputFile: job.inputFile,
    outputFile: job.outputFile,
    preset: job.preset,
    options: job.options
  };

  if (job.status === 'completed') {
    response.downloadUrl = job.downloadUrl;
    response.outputSize = formatSize(job.outputSize);
    response.processingTime = ((job.endTime - job.startTime) / 1000).toFixed(1) + 's';
  } else if (job.status === 'failed') {
    response.error = job.error;
  }

  res.json(response);
});

// Sever-sent events para actualizaciones en tiempo real
app.get("/job/:jobId/progress", (req, res) => {
  const jobId = req.params.jobId;
  const job = activeJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Comenzar SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Enviar estado inicial
  res.write(`data: ${JSON.stringify({ 
    status: job.status, 
    progress: job.progress 
  })}\n\n`);

  // Configurar listeners
  const progressHandler = (data) => {
    if (data.jobId === jobId) {
      res.write(`data: ${JSON.stringify({ 
        status: 'processing', 
        progress: data.progress 
      })}\n\n`);
    }
  };

  const completedHandler = (data) => {
    if (data.jobId === jobId) {
      res.write(`data: ${JSON.stringify({ 
        status: 'completed', 
        progress: 100,
        downloadUrl: job.downloadUrl 
      })}\n\n`);
      cleanup();
    }
  };

  const errorHandler = (data) => {
    if (data.jobId === jobId) {
      res.write(`data: ${JSON.stringify({ 
        status: 'failed', 
        error: data.error 
      })}\n\n`);
      cleanup();
    }
  };

  const cleanup = () => {
    jobEmitter.removeListener('progress', progressHandler);
    jobEmitter.removeListener('completed', completedHandler);
    jobEmitter.removeListener('error', errorHandler);
  };

  jobEmitter.on('progress', progressHandler);
  jobEmitter.on('completed', completedHandler);
  jobEmitter.on('error', errorHandler);

  // Limpiar listeners al cerrar la conexión
  req.on('close', cleanup);
});

// Descargar archivo convertido
app.get("/download/:jobId", async (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job no encontrado' });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Job no completado', status: job.status });
  }

  const outputPath = path.join(outputsDir, job.outputFile);
  
  if (!fsSync.existsSync(outputPath)) {
    return res.status(404).json({ error: 'Output file no encontrado' });
  }

  res.download(outputPath, job.outputFile, async (err) => {
    if (err && !res.headersSent) {
      console.error('Download error:', err);
      res.status(500).json({ error: 'Descarga fallida' });
    }

    // LLimpiar archivos 5 segundos después de la descarga
    setTimeout(async () => {
      const inputPath = path.join(uploadsDir, job.inputFile);
      await cleanupFiles(inputPath, outputPath);
      activeJobs.delete(req.params.jobId);
    }, 5000);
  });
});

// Get all active jobs
app.get("/jobs", (req, res) => {
  const jobs = Array.from(activeJobs.values()).map(job => ({
    id: job.id,
    status: job.status,
    progress: job.progress,
    inputFile: job.inputFile,
    preset: job.preset,
    createdAt: job.createdAt
  }));
  
  res.json(jobs);
});

// Revisar estado del servidor
app.get("/health", async (req, res) => {
  try {
    // Revisar si ffmpeg está disponible
    const ffmpegVersion = await new Promise((resolve) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        resolve(!err);
      });
    });

    const status = {
      status: ffmpegVersion ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      activeJobs: activeJobs.size,
      ffmpeg: ffmpegVersion ? 'available' : 'unavailable',
      diskSpace: await checkDiskSpace()
    };

    res.status(ffmpegVersion ? 200 : 503).json(status);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Revisar espacio en disco
async function checkDiskSpace() {
  try {
    const stats = await fs.stat(outputsDir);
    return 'available';
  } catch {
    return 'unknown';
  }
}

// Observar y analizar propiedades del archivo multimedia
app.post("/analyze", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se ha subido ningún archivo" });
  }

  const inputPath = req.file.path;

  try {
    const mediaInfo = await getMediaInfo(inputPath);
    
    res.json({
      filename: req.file.originalname,
      size: formatSize(req.file.size),
      ...mediaInfo,
      duration: mediaInfo.duration ? `${Math.round(mediaInfo.duration)}s` : 'unknown',
      recommendations: getRecommendations(mediaInfo)
    });

    // Limpiar después de analizar
    await cleanupFiles(inputPath);
  } catch (error) {
    console.error('Error analyzing file:', error);
    await cleanupFiles(inputPath);
    res.status(500).json({ error: 'Error al analizar el archivo' });
  }
});

function getRecommendations(mediaInfo) {
  const recommendations = [];
  
  if (mediaInfo.video) {
    if (mediaInfo.video.width > 1920 || mediaInfo.video.height > 1080) {
      recommendations.push('Considera reducir la resolución a 1080p para mejorar la compatibilidad');
    }
    if (mediaInfo.video.codec === 'hevc' || mediaInfo.video.codec === 'h265') {
      recommendations.push('El códec HEVC puede tener problemas de compatibilidad, considera convertir a H.264');
    }
  }
  
  if (mediaInfo.bitrate > 10000000) {
    recommendations.push('Se detectó un bitrate alto, se recomienda la compresión para reducir el tamaño del archivo');
  }
  
  return recommendations;
}

// Ruta raíz
app.get("/", (req, res) => {
  res.json({ 
    name: "API de Conversión de Video Avanzada",
    version: "2.0",
    endpoints: {
      "POST /convert": "Upload and convert video with presets",
      "POST /extract-audio": "Extract audio from video",
      "POST /analyze": "Analyze media file properties",
      "GET /presets": "Get available conversion presets",
      "GET /job/:jobId": "Get job status",
      "GET /job/:jobId/progress": "Real-time progress updates (SSE)",
      "GET /download/:jobId": "Download converted file",
      "GET /jobs": "List all active jobs",
      "GET /health": "Health check"
    },
    features: [
      "Multiple quality presets",
      "Real-time progress tracking",
      "Job queue management",
      "Media analysis",
      "Custom resolution and time range",
      "Web-optimized output",
      "AV1 codec support"
    ]
  });
});

// Limpieza periódica de archivos temporales y trabajos antiguos
setInterval(async () => {
  console.log('Running periodic cleanup...');
  
  const dirs = [uploadsDir, outputsDir, tempDir];
  const maxAge = 3600000 * 3; // 3 hours
  
  for (const dir of dirs) {
    try {
      const files = await fs.readdir(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        
        if (Date.now() - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath);
          console.log(`Cleaned up old file: ${file}`);
        }
      }
    } catch (error) {
      console.error(`Error cleaning ${dir}:`, error);
    }
  }

  // Limpiar trabajos completados
  for (const [jobId, job] of activeJobs.entries()) {
    if (job.status === 'completed' && Date.now() - job.endTime > maxAge) {
      activeJobs.delete(jobId);
      console.log(`Removed old job: ${jobId}`);
    }
  }
}, 3600000);

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`
    🎬 Conversor de Video API
    ================================
    Servidor en ejecución en http://localhost:${PORT}

    Inicio Rápido:
    - Subir video: POST http://localhost:${PORT}/convert
    - Revisar presets: GET http://localhost:${PORT}/presets
    - Ver documentación de la API: GET http://localhost:${PORT}

    ¡Listo para procesar videos!
  `);
});

// Cierres limpios
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
  console.log('\nCerrando el servidor de forma ordenada...');

  // Dejar de aceptar nuevas conexiones
  server.close(() => {
    console.log('Servidor HTTP cerrado');
  });

  // Cancelar trabajos activos
  for (const [jobId, job] of activeJobs.entries()) {
    if (job.status === 'processing') {
      job.status = 'cancelled';
      console.log(`Trabajo cancelado: ${jobId}`);
    }
  }

  // Limpiar archivos temporales
  try {
    const tempFiles = await fs.readdir(tempDir);
    for (const file of tempFiles) {
      await fs.unlink(path.join(tempDir, file));
    }
    console.log('Limpiar archivos temporales');
  } catch (error) {
    console.error('Error durante la limpieza:', error);
  }
  
  process.exit(0);
}