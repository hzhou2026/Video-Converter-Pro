const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");

const app = express();

// Create directories if they don't exist
const uploadsDir = "uploads";
const outputsDir = "outputs";

[uploadsDir, outputsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer with file size limit and file type validation
const upload = multer({ 
  dest: uploadsDir,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept video files by MIME type or file extension
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.hevc', '.h265', '.webm', '.flv', '.wmv', '.m4v', '.3gp'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (file.mimetype.startsWith('video/') || videoExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'), false);
    }
  }
});

// Add basic error handling middleware
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

// Cleanup function to remove temporary files
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
  // Validate that a file was uploaded
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
      "-crf 30", // AV1 can use higher CRF values (30-35 is good)
      "-preset 6", // AV1 preset (0-10, higher = faster but less efficient)
      "-movflags +faststart" // Optimize for web streaming
    ])
    .on("start", (commandLine) => {
      console.log('FFmpeg process started:', commandLine);
    })
    .on("progress", (progress) => {
      console.log(`Processing: ${progress.percent}% done`);
    })
    .on("end", () => {
      console.log(`Video conversion completed: ${outputFilename}`);
      
      // Send the converted file
      res.download(outputPath, outputFilename, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        
        // Clean up files after download (or error)
        cleanupFiles(inputPath, outputPath);
      });
    })
    .on("error", (err) => {
      console.error('FFmpeg error:', err);
      
      // Clean up files on error
      cleanupFiles(inputPath, outputPath);
      
      // Send error response
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Error processing video",
          details: err.message 
        });
      }
    })
    .save(outputPath);
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// MP3 conversion endpoint
app.post("/upload-mp3", upload.single("video"), (req, res) => {
  // Validate that a file was uploaded
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded" });
  }

  const inputPath = req.file.path;
  const outputFilename = `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, "")}-audio.mp3`;
  const outputPath = path.join(outputsDir, outputFilename);

  console.log(`Extracting audio to MP3: ${req.file.originalname}`);

  ffmpeg(inputPath)
    .noVideo() // Remove video stream
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
      
      // Send the converted file
      res.download(outputPath, outputFilename, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        
        // Clean up files after download (or error)
        cleanupFiles(inputPath, outputPath);
      });
    })
    .on("error", (err) => {
      console.error('FFmpeg error:', err);
      
      // Clean up files on error
      cleanupFiles(inputPath, outputPath);
      
      // Send error response
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Error extracting audio",
          details: err.message 
        });
      }
    })
    .save(outputPath);
});

// AV1 conversion endpoint
app.post("/upload-av1", upload.single("video"), (req, res) => {
  // Validate that a file was uploaded
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded" });
  }

  const inputPath = req.file.path;
  const outputFilename = `${Date.now()}-${req.file.originalname.replace(/\.[^/.]+$/, "")}-av1.mp4`;
  const outputPath = path.join(outputsDir, outputFilename);

  console.log(`Converting to AV1: ${req.file.originalname}`);

  ffmpeg(inputPath)
    .videoCodec("libaom-av1")
    .size("1280x720")
    .outputOptions([
      "-crf 30", // Good quality for AV1
      "-preset 6", // Balance between speed and efficiency
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
      
      // Send the converted file
      res.download(outputPath, outputFilename, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        
        // Clean up files after download (or error)
        cleanupFiles(inputPath, outputPath);
      });
    })
    .on("error", (err) => {
      console.error('FFmpeg AV1 error:', err);
      
      // Clean up files on error
      cleanupFiles(inputPath, outputPath);
      
      // Send error response
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Error converting to AV1",
          details: err.message 
        });
      }
    })
    .save(outputPath);
});

// Basic route
app.get("/", (req, res) => {
  res.json({ 
    message: "Video Conversion API",
    endpoints: {
      "POST /upload": "Upload and convert video to MP4 (AV1)",
      "POST /upload-av1": "Upload and convert video to AV1",
      "POST /upload-mp3": "Upload and extract audio to MP3",
      "GET /health": "Health check"
    }
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Upload videos to http://localhost:${PORT}/upload`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});