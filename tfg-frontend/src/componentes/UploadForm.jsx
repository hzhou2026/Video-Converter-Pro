import React, { useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { api } from '../servicios/api';

const VIDEO_TYPES = new Set([
  'video/mp4', 'video/avi', 'video/mov', 'video/mkv', 
  'video/webm', 'video/flv', 'video/wmv', 'video/m4v',
  'video/3gp', 'video/ogv', 'video/x-msvideo', 'video/quicktime'
]);

const VIDEO_EXTENSIONS = /\.(mp4|avi|mov|mkv|webm|flv|wmv|m4v|3gp|ogv|hevc|h265|mts|m2ts|ts|vob|mpg|mpeg)$/i;

const DEFAULT_OPTIONS = {
  format: 'mp4',
  resolution: '',
  startTime: '',
  duration: '',
  removeAudio: false,
  normalizeAudio: false,
  denoise: false,
  stabilize: false,
  speed: 1,
  crop: '',
  rotate: 0,
  flip: ''
};

const BASE_RESOLUTIONS = [
  { value: '3840x2160', label: '4K (3840x2160)' },
  { value: '1920x1080', label: 'Full HD (1920x1080)' },
  { value: '1280x720', label: 'HD (1280x720)' },
  { value: '854x480', label: '480p' },
  { value: '640x360', label: '360p' }
];

const FORMATS = ['mp4', 'webm', 'avi', 'mov', 'mkv'];

const CHECKBOX_OPTIONS = [
  { key: 'removeAudio', label: 'Eliminar Audio' },
  { key: 'normalizeAudio', label: 'Normalizar Audio' },
  { key: 'denoise', label: 'Reducir Ruido' },
  { key: 'stabilize', label: 'Estabilizar Video' }
];

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDuration = (seconds) => {
  if (!seconds) return '0s';
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

const isVideoFile = (file) => {
  return VIDEO_TYPES.has(file.type) || VIDEO_EXTENSIONS.test(file.name);
};

const UploadForm = ({ presets = {}, formats = [], onJobCreated = () => {} }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState('balanced');
  const [customOptions, setCustomOptions] = useState(DEFAULT_OPTIONS);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  // Generar opciones de resolución dinámicamente
  const resolutions = [
    { 
      value: '', 
      label: fileInfo?.video 
        ? `Original (${fileInfo.video.width}x${fileInfo.video.height})` 
        : 'Original'
    },
    ...BASE_RESOLUTIONS
  ];

  const handleFileSelect = async (file) => {
    if (!isVideoFile(file)) {
      setUploadError('Por favor selecciona un archivo de video válido');
      return;
    }

    setSelectedFile(file);
    setUploadError(null);
    
    try {
      const data = await api.analyzeFile(file);
      setFileInfo(data.info);
      setAnalysisResults(data);
    } catch (error) {
      console.error('Error analyzing file:', error);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFileSelect(files[0]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const resetForm = () => {
    setSelectedFile(null);
    setFileInfo(null);
    setAnalysisResults(null);
    setUploadError(null);
    setCustomOptions(DEFAULT_OPTIONS);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!selectedFile) {
      setUploadError('Por favor selecciona un archivo');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append('video', selectedFile);
    formData.append('preset', selectedPreset);
    
    for (const [key, value] of Object.entries(customOptions)) {
      if (value !== '' && value !== false && value !== 0 && value !== null) {
        formData.append(key, value);
      }
    }

    try {
      const response = await fetch('http://localhost:3000/api/convert', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al subir el archivo');
      }

      const data = await response.json();
      onJobCreated(data);
      resetForm();
    } catch (error) {
      console.error('Error uploading file:', error);
      setUploadError(error.message || 'Error al iniciar la conversión');
    } finally {
      setIsUploading(false);
    }
  };

  const updateOption = (key, value) => {
    setCustomOptions(prev => ({ ...prev, [key]: value }));
  };

  const applySuggestion = (preset) => {
    setSelectedPreset(preset);
  };

  return (
    <div className="upload-form">
      {/* Sección de Subida */}
      <div className="upload-section">
        <h2>Subir Video para Conversión</h2>
        
        <button
          type="button"
          className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              fileInputRef.current?.click();
            }
          }}
          style={{ width: '100%', background: 'none', border: 'none', padding: 0 }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            style={{ display: 'none' }}
            aria-label="Seleccionar archivo de video"
          />
          
          {selectedFile ? (
            <div className="file-selected">
              <div className="file-icon">🎬</div>
              <div className="file-details">
                <h3>{selectedFile.name}</h3>
                <p>Tamaño: {formatFileSize(selectedFile.size)}</p>
                {fileInfo && (
                  <div className="file-info">
                    <p>Duración: {formatDuration(fileInfo.duration)}</p>
                    {fileInfo.video && (
                      <>
                        <p>Resolución: {fileInfo.video.width}x{fileInfo.video.height}</p>
                        <p>Codec: {fileInfo.video.codec}</p>
                      </>
                    )}
                    <p>Formato: {fileInfo.format}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="drop-zone-content">
              <div className="drop-icon">📁</div>
              <h3>Arrastra tu video aquí o haz clic para seleccionar</h3>
              <p>Formatos soportados: MP4, AVI, MOV, MKV, WEBM, HEVC, y más</p>
              <p style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
                Tamaño máximo: 2GB
              </p>
            </div>
          )}
        </button>

        {/* Error de subida */}
        {uploadError && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: '#ffebee',
            borderRadius: '8px',
            color: '#c62828',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
          role="alert"
          >
            ⚠️ {uploadError}
          </div>
        )}

        {/* Sugerencias de análisis */}
        {analysisResults?.suggestions && analysisResults.suggestions.length > 0 && (
          <div className="analysis-suggestions">
            <h3>💡 Recomendaciones de Optimización</h3>
            {analysisResults.suggestions.map((suggestion) => (
              <div 
                key={`${suggestion.type}-${suggestion.message}-${suggestion.preset || ''}`} 
                className="suggestion-item"
              >
                <span className="suggestion-type">{suggestion.type}</span>
                <span className="suggestion-message">{suggestion.message}</span>
                {suggestion.preset && (
                  <button 
                    className="btn-apply-suggestion"
                    onClick={() => applySuggestion(suggestion.preset)}
                    type="button"
                  >
                    Aplicar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Opciones de Conversión */}
      <div className="conversion-options">
        <form onSubmit={handleSubmit}>
          <div className="options-grid">
            {/* Sección de Presets */}
            <div className="preset-section">
              <h3>Preset de Conversión</h3>
              <select 
                value={selectedPreset} 
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="preset-select"
              >
                {Object.entries(presets).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {key.charAt(0).toUpperCase() + key.slice(1).replaceAll('-', ' ')} - {preset.description}
                  </option>
                ))}
              </select>
              
              {presets[selectedPreset] && (
                <div className="preset-details">
                  <p><strong>Codec Video:</strong> {presets[selectedPreset].videoCodec}</p>
                  <p><strong>Codec Audio:</strong> {presets[selectedPreset].audioCodec}</p>
                  {presets[selectedPreset].crf && (
                    <p><strong>Calidad (CRF):</strong> {presets[selectedPreset].crf}</p>
                  )}
                  {presets[selectedPreset].preset && (
                    <p><strong>Velocidad:</strong> {presets[selectedPreset].preset}</p>
                  )}
                </div>
              )}
            </div>

            {/* Opciones Personalizadas */}
            <div className="custom-options">
              <h3>Opciones Personalizadas</h3>
              
              <div className="option-group">
                <label htmlFor="format-select">Formato de Salida:</label>
                <select 
                  id="format-select"
                  value={customOptions.format}
                  onChange={(e) => updateOption('format', e.target.value)}
                >
                  {FORMATS.map(fmt => (
                    <option key={fmt} value={fmt}>
                      {fmt.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="option-group">
                <label htmlFor="resolution-select">Resolución:</label>
                <select 
                  id="resolution-select"
                  value={customOptions.resolution}
                  onChange={(e) => updateOption('resolution', e.target.value)}
                >
                  {resolutions.map(res => (
                    <option key={res.value} value={res.value}>
                      {res.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="option-row">
                <div className="option-group">
                  <label htmlFor="start-time">Inicio (segundos):</label>
                  <input 
                    id="start-time"
                    type="number"
                    min="0"
                    step="0.1"
                    value={customOptions.startTime}
                    onChange={(e) => updateOption('startTime', e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="option-group">
                  <label htmlFor="duration">Duración (segundos):</label>
                  <input 
                    id="duration"
                    type="number"
                    min="0"
                    step="0.1"
                    value={customOptions.duration}
                    onChange={(e) => updateOption('duration', e.target.value)}
                    placeholder="Completo"
                  />
                </div>
              </div>

              <div className="option-group">
                <label htmlFor="speed-control">Velocidad de Reproducción: {customOptions.speed}x</label>
                <input 
                  id="speed-control"
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.1"
                  value={customOptions.speed}
                  onChange={(e) => updateOption('speed', Number.parseFloat(e.target.value))}
                />
              </div>

              {/* Checkboxes */}
              <div className="checkboxes-group">
                {CHECKBOX_OPTIONS.map(({ key, label }) => (
                  <label key={key} className="checkbox-label">
                    <input 
                      type="checkbox"
                      checked={customOptions[key]}
                      onChange={(e) => updateOption(key, e.target.checked)}
                      aria-label={label}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Acciones del Formulario */}
          <div className="form-actions">
            <button 
              type="submit" 
              disabled={!selectedFile || isUploading}
              className="btn-convert"
            >
              {isUploading ? '⏳ Procesando...' : '🚀 Iniciar Conversión'}
            </button>
            
            {selectedFile && !isUploading && (
              <button 
                type="button"
                onClick={resetForm}
                className="btn-clear"
              >
                🗑️ Limpiar
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

UploadForm.propTypes = {
  presets: PropTypes.object,
  formats: PropTypes.array,
  onJobCreated: PropTypes.func
};

export default UploadForm;

