// ===================== VALIDACIÓN DE COMPATIBILIDAD =====================

const PRESET_FORMAT_COMPATIBILITY = {
  
  // RAW/Sin compresión (solo AVI)
  'avi-raw-uncompressed': ['avi'],
  'avi-raw-rgb': ['avi'],
  
  // Lossless AVI
  'avi-ffv1-lossless': ['avi'],
  'avi-huffyuv-lossless': ['avi'],
  'avi-utvideo-lossless': ['avi'],
  'avi-dv-pal': ['avi'],
  'avi-dv-ntsc': ['avi'],
  'avi-mjpeg-high': ['avi'],
  'avi-mjpeg-normal': ['avi'],
  
  // ProRes (solo MOV)
  'prores-proxy': ['mov'],
  'prores-lt': ['mov'],
  'prores-standard': ['mov'],
  'prores-hq': ['mov'],
  
  // WebM específicos
  'webm-vp9': ['webm'],
  'webm-vp8-fast': ['webm'],
  
  // Otros formatos específicos
  'gif-animated': ['gif'],
  
  // H.264
  'h264-ultra': ['mp4', 'mkv', 'mov', 'avi'],
  'h264-high': ['mp4', 'mkv', 'mov', 'avi'],
  'h264-normal': ['mp4', 'mkv', 'mov', 'avi'],
  'h264-fast': ['mp4', 'mkv', 'mov', 'avi'],
  
  // H.265
  'h265-high': ['mp4', 'mkv', 'mov'],
  'h265-normal': ['mp4', 'mkv', 'mov'],
  
  // AV1
  'av1-high': ['mp4', 'mkv', 'webm'],
  'av1-normal': ['mp4', 'mkv', 'webm'],
  
  // VP9
  'vp9-web': ['webm', 'mkv'],
  
  // Streaming & Web
  'web-streaming': ['mp4', 'mkv'],
  'mobile-optimized': ['mp4'],
  
  // Redes Sociales
  'youtube-4k': ['mp4', 'mkv', 'mov'],
  'youtube-1080p': ['mp4', 'mkv', 'mov'],
  'instagram-post': ['mp4', 'mov'],
  'instagram-reel': ['mp4', 'mov'],
  'tiktok-video': ['mp4', 'mov'],
  'twitter-video': ['mp4', 'mov']
};

// Códecs compatibles por formato
const FORMAT_CODEC_COMPATIBILITY = {
  'mp4': {
    video: ['libx264', 'libx265', 'mpeg4', 'libaom-av1'],
    audio: ['aac', 'mp3', 'ac3', 'opus']
  },
  'mkv': {
    video: ['libx264', 'libx265', 'libvpx-vp9', 'libaom-av1', 'mpeg4', 'ffv1'],
    audio: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'ac3']
  },
  'webm': {
    video: ['libvpx', 'libvpx-vp9', 'libaom-av1'],
    audio: ['opus', 'vorbis']
  },
  'avi': {
    video: ['rawvideo', 'huffyuv', 'ffv1', 'utvideo', 'dvvideo', 'mjpeg', 'mpeg4', 'libx264'],
    audio: ['pcm_s16le', 'mp3', 'ac3',"aac"]
  },
  'mov': {
    video: ['libx264', 'libx265', 'prores_ks', 'mpeg4'],
    audio: ['aac', 'pcm_s16le', 'mp3']
  },
  'gif': {
    video: ['gif'],
    audio: []
  },
};

// Valida si un preset es compatible con un formato
function validatePresetFormatCompatibility(preset, format) {
  const compatibleFormats = PRESET_FORMAT_COMPATIBILITY[preset];
  
  if (!compatibleFormats) {
    return {
      valid: true,
      message: null
    };
  }
  
  if (!compatibleFormats.includes(format)) {
    return {
      valid: false,
      message: `El preset "${preset}" solo es compatible con formato(s): ${compatibleFormats.join(', ')}. No puede usarse con "${format}".`,
      suggestedFormats: compatibleFormats
    };
  }
  
  return {
    valid: true,
    message: null
  };
}

// Valida si un códec es compatible con un formato
function validateCodecFormatCompatibility(videoCodec, audioCodec, format) {
  const formatCompat = FORMAT_CODEC_COMPATIBILITY[format];
  
  if (!formatCompat) {
    return {
      valid: false,
      message: `Formato "${format}" no soportado o desconocido.`,
      supportedFormats: Object.keys(FORMAT_CODEC_COMPATIBILITY)
    };
  }
  
  const errors = [];
  
  // Validar codec de video
  if (videoCodec && !formatCompat.video.includes(videoCodec)) {
    errors.push(
      `El códec de video "${videoCodec}" no es compatible con "${format}". ` +
      `Códecs compatibles: ${formatCompat.video.join(', ')}`
    );
  }
  
  // Validar codec de audio
  if (audioCodec && formatCompat.audio.length > 0 && !formatCompat.audio.includes(audioCodec)) {
    errors.push(
      `El códec de audio "${audioCodec}" no es compatible con "${format}". ` +
      `Códecs compatibles: ${formatCompat.audio.join(', ')}`
    );
  }
  
  if (errors.length > 0) {
    return {
      valid: false,
      message: errors.join(' '),
      supportedVideoCodecs: formatCompat.video,
      supportedAudioCodecs: formatCompat.audio
    };
  }
  
  return {
    valid: true,
    message: null
  };
}

// Valida todas las compatibilidades antes de iniciar conversión
function validateConversionCompatibility(preset, format, presetConfig) {
  // Validar preset con formato
  const presetValidation = validatePresetFormatCompatibility(preset, format);
  if (!presetValidation.valid) {
    return presetValidation;
  }

  // Validar códecs con formato
  const codecValidation = validateCodecFormatCompatibility(
    presetConfig.videoCodec,
    presetConfig.audioCodec,
    format
  );
  if (!codecValidation.valid) {
    return codecValidation;
  }
  
  // Validaciones especiales
  
  // WebM requiere códecs específicos
  if (format === 'webm') {
    if (presetConfig.videoCodec && 
        !['libvpx', 'libvpx-vp9', 'libaom-av1'].includes(presetConfig.videoCodec)) {
      return {
        valid: false,
        message: `WebM requiere códec de video VP8 (libvpx), VP9 (libvpx-vp9) o AV1 (libaom-av1). "${presetConfig.videoCodec}" no es compatible.`
      };
    }
    
    if (presetConfig.audioCodec && 
        !['opus', 'vorbis'].includes(presetConfig.audioCodec)) {
      return {
        valid: false,
        message: `WebM requiere códec de audio Opus (opus) o Vorbis (vorbis). "${presetConfig.audioCodec}" no es compatible.`
      };
    }
  }
  
  // GIF no puede tener audio
  if (format === 'gif' && presetConfig.audioCodec) {
    return {
      valid: false,
      message: 'GIF no soporta audio. El audio será removido automáticamente o elige otro formato.'
    };
  }
  
  return {
    valid: true,
    message: 'Configuración válida'
  };
}

// Obtiene el formato correcto basado en preset y formato solicitado
function resolveOutputFormat(preset, requestedFormat, presetConfig) {
  // Si el preset tiene formato fijo, usarlo
  if (presetConfig.outputFormat) {
    return presetConfig.outputFormat;
  }
  
  // Si el preset tiene restricciones, validar
  const compatibleFormats = PRESET_FORMAT_COMPATIBILITY[preset];
  if (compatibleFormats) {
    if (!compatibleFormats.includes(requestedFormat)) {
      // Usar el primer formato compatible
      return compatibleFormats[0];
    }
  }
  
  // Usar formato solicitado
  return requestedFormat;
}

// Mapeo de formatos de usuario a formatos FFmpeg
const FORMAT_MAPPINGS = {
  'mkv': 'matroska',
  'mp4': 'mp4',
  'webm': 'webm',
  'avi': 'avi',
  'mov': 'mov',
  'gif': 'gif',
  'flv': 'flv',
  'wmv': 'asf',
  'm4v': 'mp4',
};

// Función mejorada para aplicar formato de salida
function applyOutputFormat(command, preset, format, presetConfig) {
  const resolvedFormat = resolveOutputFormat(preset, format, presetConfig);
  
  // Convertir formato de usuario a formato FFmpeg
  const ffmpegFormat = FORMAT_MAPPINGS[resolvedFormat] || resolvedFormat;
  
  // Aplicar formato
  command.toFormat(ffmpegFormat);
  
  // Aplicar configuraciones específicas por formato
  switch (resolvedFormat) {
    case 'webm':
      // Si no tiene códecs WebM definidos, aplicar por defecto
      if (!presetConfig.videoCodec || 
          !['libvpx', 'libvpx-vp9', 'libaom-av1'].includes(presetConfig.videoCodec)) {
        command.videoCodec('libvpx-vp9');
        command.outputOptions(['-crf', '31', '-b:v', '0']);
      }
      if (!presetConfig.audioCodec || 
          !['opus', 'vorbis'].includes(presetConfig.audioCodec)) {
        command.audioCodec('opus');
      }
      break;
      
    case 'mkv':
      // asegurar compatibilidad de MKV
      if (!presetConfig.videoCodec) {
        command.videoCodec('libx264');
      }
      if (!presetConfig.audioCodec) {
        command.audioCodec('aac');
      }
      break;
      
    case 'mp4':
      // MP4 necesita faststart para streaming
      if (!presetConfig.extraOptions?.includes('-movflags')) {
        command.outputOptions(['-movflags', '+faststart']);
      }
      break;
      
    case 'gif':
      // GIF no soporta audio, removerlo automáticamente
      command.noAudio();
      break;
  }
  
  return resolvedFormat;
}

// Exportar funciones y constantes
export {
  validateConversionCompatibility,
  resolveOutputFormat,
  applyOutputFormat,
  validateCodecFormatCompatibility,
  PRESET_FORMAT_COMPATIBILITY,
  FORMAT_CODEC_COMPATIBILITY,
};