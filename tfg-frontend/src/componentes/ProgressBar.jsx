import React from 'react';
import PropTypes from 'prop-types';
import './ProgressBar.css';

const ProgressBar = ({ job, onCancel }) => {
  if (!job) {
    return null;
  }

  const getProgressPercentage = () => {
    if (job.status === 'completed') return 100;
    if (['failed', 'cancelled'].includes(job.status)) return 0;
    return job.progress || 0;
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    } else if (m > 0) {
      return `${m}m ${s}s`;
    } else {
      return `${s}s`;
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getStatusColor = () => {
    const colors = {
      queued: '#ffa500',
      processing: '#4CAF50',
      completed: '#2196F3',
      failed: '#f44336',
      cancelled: '#9e9e9e'
    };
    return colors[job.status] || '#757575';
  };

  const getStatusText = () => {
    const texts = {
      queued: 'En Cola',
      processing: 'Procesando',
      completed: 'Completado',
      failed: 'Fallido',
      cancelled: 'Cancelado'
    };
    return texts[job.status] || 'Desconocido';
  };

  const progress = getProgressPercentage();
  const statusColor = getStatusColor();
  const canCancel = job.status === 'queued' || job.status === 'processing';
  const isCompleted = job.status === 'completed';

  return (
    <div className="progress-card">
      {/* Encabezado */}
      <div className="progress-header">
        <div className="progress-info">
          <h4 className="progress-title">
            {job.inputName || job.filename || 'Video'}
          </h4>
          <span 
            className="progress-status" 
            style={{ color: statusColor }}
          >
            {getStatusText()}
          </span>
        </div>
        
        {canCancel && (
          <button
            onClick={() => onCancel(job.id)}
            className="btn-cancel"
            title="Cancelar trabajo"
          >
            ✕
          </button>
        )}
      </div>

      {/* ProgressBar */}
      <div className="progress-bar-container">
        <div className="progress-bar-track">
          <div
            className="progress-bar-fill"
            style={{
              width: `${progress}%`,
              backgroundColor: statusColor,
              transition: job.status === 'processing' ? 'width 0.5s ease' : 'none'
            }}
          />
        </div>
        <span className="progress-percentage">
          {progress.toFixed(1)}%
        </span>
      </div>

      {/* Detalles del Progreso */}
      {(job.currentTime || job.fps || job.result) && (
        <div className="progress-details">
          {job.currentTime && (
            <div className="detail-item">
              <span className="detail-label">Duración del video:</span>
              <span className="detail-value">{job.currentTime}</span>
            </div>
          )}
          {job.fps && (
            <div className="detail-item">
              <span className="detail-label">FPS:</span>
              <span className="detail-value">{parseFloat(job.fps).toFixed(2)}</span>
            </div>
          )}
          {job.speed && (
            <div className="detail-item">
              <span className="detail-label">Velocidad:</span>
              <span className="detail-value">{job.speed}</span>
            </div>
          )}
          {job.result?.outputSize && (
            <div className="detail-item">
              <span className="detail-label">Tamaño:</span>
              <span className="detail-value">{formatFileSize(job.result.outputSize)}</span>
            </div>
          )}
          {job.result?.processingTime && (
            <div className="detail-item">
              <span className="detail-label">Tiempo de conversión:</span>
              <span className="detail-value">
                {formatTime(job.result.processingTime / 1000)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Acciones de los botones */}
      {isCompleted && job.result && (
        <div className="progress-actions">
          <a
            href={`http://localhost:3000/api/download/${job.id}`}
            className="btn-action btn-download"
            download
          >
            📥 Descargar
          </a>
          {job.result.thumbnailPath && (
            <a
              href={`http://localhost:3000/api/stream/${job.id}`}
              className="btn-action btn-preview"
              target="_blank"
              rel="noopener noreferrer"
            >
              ▶️ Vista Previa
            </a>
          )}
        </div>
      )}

      {/* Mensaje de Error */}
      {job.error && (
        <div className="progress-error">
          <span className="error-icon">⚠️</span>
          <span className="error-message">{job.error}</span>
        </div>
      )}
    </div>
  );
};
ProgressBar.propTypes = {
  job: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    status: PropTypes.string,
    progress: PropTypes.number,
    inputName: PropTypes.string,
    filename: PropTypes.string,
    currentTime: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    fps: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    speed: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    result: PropTypes.shape({
      outputSize: PropTypes.number,
      processingTime: PropTypes.number,
      thumbnailPath: PropTypes.string
    }),
    error: PropTypes.string
  }),
  onCancel: PropTypes.func.isRequired
};

export default ProgressBar;
