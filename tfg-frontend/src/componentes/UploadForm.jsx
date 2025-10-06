import React, { useState, useRef } from 'react';

const UploadForm = ({ presets, formats, onJobCreated }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState('balanced');
  const [customOptions, setCustomOptions] = useState({
    format: 'mp4',
    resolution: '',
    startTime: '',
    duration: '',
    removeAudio: false,
    calculateMetrics: false,
    twoPass: false,
    normalizeAudio: false,
    denoise: false,
    stabilize: false,
    speed: 1.0,
    crop: '',
    rotate: 0,
    flip: ''
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [analysisResults, setAnalysisResults] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = (file) => {
    setSelectedFile(file);
    analyzeFile(file);
  };

  const analyzeFile = async (file) => {
    const formData = new FormData();
    formData.append('media', file);

    try {
      const response = await fetch('http://localhost:3000/api/analyze', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
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
    if (files.length > 0 && isVideoFile(files[0])) {
      handleFileSelect(files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const isVideoFile = (file) => {
    const videoTypes = [
      'video/mp4', 'video/avi', 'video/mov', 'video/mkv', 
      'video/webm', 'video/flv', 'video/wmv', 'video/m4v',
      'video/3gp', 'video/ogv', 'video/x-msvideo'
    ];
    return videoTypes.includes(file.type) || 
           /\.(mp4|avi|mov|mkv|webm|flv|wmv|m4v|3gp|ogv|hevc|h265|mts|m2ts|ts|vob|mpg|mpeg)$/i.test(file.name);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('video', selectedFile);
    
    // Add all options
    Object.entries(customOptions).forEach(([key, value]) => {
      if (value !== '' && value !== false && value !== 0) {
        formData.append(key, value);
      }
    });
    formData.append('preset', selectedPreset);

    try {
      const response = await fetch('http://localhost:3000/api/convert', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      onJobCreated(data);
      
      // Reset form
      setSelectedFile(null);
      setFileInfo(null);
      setAnalysisResults(null);
      setCustomOptions({
        format: 'mp4',
        resolution: '',
        startTime: '',
        duration: '',
        removeAudio: false,
        calculateMetrics: false,
        twoPass: false,
        normalizeAudio: false,
        denoise: false,
        stabilize: false,
        speed: 1.0,
        crop: '',
        rotate: 0,
        flip: ''
      });
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="upload-form">
      <div className="upload-section">
        <h2>Subir Video para Conversión</h2>
        
        <div 
          className={`drop-zone ${isDragOver ? 'drag-over' : ''} ${selectedFile ? 'has-file' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={(e) => e.target.files[0] && handleFileSelect(e.target.files[0])}
            style={{ display: 'none' }}
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
                      <p>Resolución: {fileInfo.video.width}x{fileInfo.video.height}</p>
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
            </div>
          )}
        </div>

        {analysisResults && analysisResults.suggestions && (
          <div className="analysis-suggestions">
            <h3>Recomendaciones de Optimización</h3>
            {analysisResults.suggestions.map((suggestion, index) => (
              <div key={index} className="suggestion-item">
                <span className="suggestion-type">{suggestion.type}:</span>
                <span className="suggestion-message">{suggestion.message}</span>
                {suggestion.preset && (
                  <button 
                    className="btn-apply-suggestion"
                    onClick={() => setSelectedPreset(suggestion.preset)}
                  >
                    Aplicar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="conversion-options">
        <div className="options-grid">
          <div className="preset-section">
            <h3>Preset de Conversión</h3>
            <select 
              value={selectedPreset} 
              onChange={(e) => setSelectedPreset(e.target.value)}
              className="preset-select"
            >
              {Object.entries(presets).map(([key, preset]) => (
                <option key={key} value={key}>
                  {key.charAt(0).toUpperCase() + key.slice(1)} - {preset.description}
                </option>
              ))}
            </select>
            
            {presets[selectedPreset] && (
              <div className="preset-details">
                <p><strong>Codec:</strong> {presets[selectedPreset].videoCodec}</p>
                <p><strong>Calidad:</strong> CRF {presets[selectedPreset].crf}</p>
                <p><strong>Velocidad:</strong> {presets[selectedPreset].preset}</p>
              </div>
            )}
          </div>

          <div className="custom-options">
            <h3>Opciones Personalizadas</h3>
            
            <div className="option-group">
              <label>Formato de Salida:</label>
              <select 
                value={customOptions.format}
                onChange={(e) => setCustomOptions({...customOptions, format: e.target.value})}
              >
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
                <option value="avi">AVI</option>
                <option value="mov">MOV</option>
                <option value="mkv">MKV</option>
              </select>
            </div>

            <div className="option-group">
              <label>Resolución:</label>
              <select 
                value={customOptions.resolution}
                onChange={(e) => setCustomOptions({...customOptions, resolution: e.target.value})}
              >
                <option value="">Original</option>
                <option value="3840x2160">4K (3840x2160)</option>
                <option value="1920x1080">Full HD (1920x1080)</option>
                <option value="1280x720">HD (1280x720)</option>
                <option value="854x480">480p</option>
                <option value="640x360">360p</option>
              </select>
            </div>

            <div className="option-row">
              <div className="option-group">
                <label>Inicio (segundos):</label>
                <input 
                  type="number"
                  value={customOptions.startTime}
                  onChange={(e) => setCustomOptions({...customOptions, startTime: e.target.value})}
                  placeholder="0"
                />
              </div>
              <div className="option-group">
                <label>Duración (segundos):</label>
                <input 
                  type="number"
                  value={customOptions.duration}
                  onChange={(e) => setCustomOptions({...customOptions, duration: e.target.value})}
                  placeholder="Completo"
                />
              </div>
            </div>

            <div className="option-group">
              <label>Velocidad de Reproducción:</label>
              <input 
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={customOptions.speed}
                onChange={(e) => setCustomOptions({...customOptions, speed: parseFloat(e.target.value)})}
              />
              <span>{customOptions.speed}x</span>
            </div>

            <div className="checkboxes-group">
              <label className="checkbox-label">
                <input 
                  type="checkbox"
                  checked={customOptions.removeAudio}
                  onChange={(e) => setCustomOptions({...customOptions, removeAudio: e.target.checked})}
                />
                Eliminar Audio
              </label>
              
              <label className="checkbox-label">
                <input 
                  type="checkbox"
                  checked={customOptions.calculateMetrics}
                  onChange={(e) => setCustomOptions({...customOptions, calculateMetrics: e.target.checked})}
                />
                Calcular Métricas de Calidad
              </label>
              
              <label className="checkbox-label">
                <input 
                  type="checkbox"
                  checked={customOptions.twoPass}
                  onChange={(e) => setCustomOptions({...customOptions, twoPass: e.target.checked})}
                />
                Codificación de Dos Pasadas
              </label>
              
              <label className="checkbox-label">
                <input 
                  type="checkbox"
                  checked={customOptions.normalizeAudio}
                  onChange={(e) => setCustomOptions({...customOptions, normalizeAudio: e.target.checked})}
                />
                Normalizar Audio
              </label>
              
              <label className="checkbox-label">
                <input 
                  type="checkbox"
                  checked={customOptions.denoise}
                  onChange={(e) => setCustomOptions({...customOptions, denoise: e.target.checked})}
                />
                Reducir Ruido
              </label>
              
              <label className="checkbox-label">
                <input 
                  type="checkbox"
                  checked={customOptions.stabilize}
                  onChange={(e) => setCustomOptions({...customOptions, stabilize: e.target.checked})}
                />
                Estabilizar Video
              </label>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button 
            type="submit" 
            disabled={!selectedFile || isUploading}
            className="btn-convert"
          >
            {isUploading ? 'Procesando...' : 'Iniciar Conversión'}
          </button>
          
          {selectedFile && (
            <button 
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setFileInfo(null);
                setAnalysisResults(null);
              }}
              className="btn-clear"
            >
              Limpiar
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default UploadForm;