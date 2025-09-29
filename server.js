const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");

const app = express();

// Crear carpetas si no existen
const uploadsDir = "uploads";
const outputsDir = "outputs";

[uploadsDir, outputsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configurar multer para manejar la subida de archivos
const upload = multer({ 
  dest: uploadsDir,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limite
  },
  fileFilter: (req, file, cb) => {
    //MMimetype de video comunes
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.hevc', '.h265', '.webm', '.flv', '.wmv', '.m4v', '.3gp'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (file.mimetype.startsWith('video/') || videoExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'), false);
    }
  }
});

// Añadiendo middleware para manejar errores de multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
  }
  
  if (error.message === 'Only video files are allowed') {
    return res.status(400).json({ error: 'Only video files are allowed' });
  }
  
  next(error);
});

// Limpiar archivos temporales
const cleanupFiles = (...filePaths) => {
  filePaths.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Error deleting file:', filePath, err);
      }
    }
  });
};

app.post("/upload", upload.single("video"), (req, res) => {
  // Validar archivo subido
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded" });
  }

  const inputPath = req.file.path;
  const outputFilename = `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, "")}-converted.mp4`;
  const outputPath = path.join(outputsDir, outputFilename);

  console.log(`Processing video: ${req.file.originalname}`);

  ffmpeg(inputPath)
    .videoCodec("libaom-av1") // Use AV1 codec instead of libx264
    .size("1280x720")
    .outputOptions([
      "-crf 30", // AV1 puede usar valores más altos para buena calidad
      "-preset 6", // AV1 preset balanceado
      "-movflags +faststart" // Optimizar para streaming web
    ])
    .on("start", (commandLine) => {
      console.log('FFmpeg process started:', commandLine);
    })
    .on("progress", (progress) => {
      console.log(`Processing: ${progress.percent}% done`);
    })
    .on("end", () => {
      console.log(`Video conversion completed: ${outputFilename}`);

      // enviar el archivo convertido
      res.download(outputPath, outputFilename, (err) => {
        if (err) {
          console.error('Download error:', err);
        }

        // Limpiar archivos después de la descarga (o error)
        cleanupFiles(inputPath, outputPath);
      });
    })
    .on("error", (err) => {
      console.error('FFmpeg error:', err);

      // Limpiar archivos en caso de error
      cleanupFiles(inputPath, outputPath);

      // Enviar respuesta de error
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Error processing video",
          details: err.message 
        });
      }
    })
    .save(outputPath);
});

// Comprobar estado del servidor
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Conversión a MP3
app.post("/upload-mp3", upload.single("video"), (req, res) => {
  // Validar que se haya subido un archivo
  if (!req.file) {
    return res.status(400).json({ error: "No se ha subido ningún archivo de video" });
  }

  const inputPath = req.file.path;
  const outputFilename = `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, "")}-audio.mp3`;
  const outputPath = path.join(outputsDir, outputFilename);

  console.log(`Extracting audio to MP3: ${req.file.originalname}`);

  ffmpeg(inputPath)
    .noVideo() // Solo audio
    .audioCodec("mp3")
    .audioBitrate(192)
    .on("start", (commandLine) => {
      console.log('FFmpeg process started:', commandLine);
    })
    .on("progress", (progress) => {
      console.log(`Processing: ${progress.percent}% done`);
    })
    .on("end", () => {
      console.log(`Audio extraction completed: ${outputFilename}`);

      // Enviar el archivo convertido
      res.download(outputPath, outputFilename, (err) => {
        if (err) {
          console.error('Download error:', err);
        }

        // Limpiar archivos después de la descarga (o error)
        cleanupFiles(inputPath, outputPath);
      });
    })
    .on("error", (err) => {
      console.error('FFmpeg error:', err);

      // Limpiar archivos en caso de error
      cleanupFiles(inputPath, outputPath);

      // Enviar respuesta de error
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Error extracting audio",
          details: err.message 
        });
      }
    })
    .save(outputPath);
});

// AV1 conversor
app.post("/upload-av1", upload.single("video"), (req, res) => {
  // Validar que se haya subido un archivo
  if (!req.file) {
    return res.status(400).json({ error: "No se ha subido ningún archivo de video" });
  }

  const inputPath = req.file.path;
  const outputFilename = `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, "")}-av1.mp4`;
  const outputPath = path.join(outputsDir, outputFilename);

  console.log(`Converting to AV1: ${req.file.originalname}`);

  ffmpeg(inputPath)
    .videoCodec("libaom-av1")
    .size("1280x720")
    .outputOptions([
      "-crf 30", // Buena calidad para AV1
      "-preset 6", // Balance entre velocidad y eficiencia
      "-movflags +faststart"
    ])
    .on("start", (commandLine) => {
      console.log('FFmpeg AV1 process started:', commandLine);
    })
    .on("progress", (progress) => {
      console.log(`Processing AV1: ${progress.percent}% done`);
    })
    .on("end", () => {
      console.log(`AV1 conversion completed: ${outputFilename}`);

      // Enviar el archivo convertido
      res.download(outputPath, outputFilename, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        
        // Limpiar archivos después de la descarga (o error)
        cleanupFiles(inputPath, outputPath);
      });
    })
    .on("error", (err) => {
      console.error('FFmpeg AV1 error:', err);

      // Limpiar archivos en caso de error
      cleanupFiles(inputPath, outputPath);

      // Enviar respuesta de error
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Error converting to AV1",
          details: err.message 
        });
      }
    })
    .save(outputPath);
});

// Ruta raíz
app.get("/", (req, res) => {
  res.json({ 
    message: "Video Conversion API",
    endpoints: {
      "POST /upload": "Subir y convertir video a MP4 (AV1)",
      "POST /upload-av1": "Subir y convertir video a AV1",
      "POST /upload-mp3": "Subir y extraer audio a MP3",
      "GET /health": "Comprobar estado del servidor"
    }
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Upload videos to http://localhost:${PORT}/upload`);
});

// Cierres limpios
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando de manera ordenada');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT recibido, cerrando de manera ordenada');
  process.exit(0);
});