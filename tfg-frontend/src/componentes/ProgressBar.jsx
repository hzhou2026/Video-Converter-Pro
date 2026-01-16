import React, { useState } from 'react';
import PropTypes from 'prop-types';
import './ProgressBar.css';

// Componente ProgressBar
const ProgressBar = ({ job, onCancel, onDownload, isDownloaded }) => {
  const [isDownloading, setIsDownloading] = useState(false);

  if (!job) {
    return null;
  }

  // Obtener el porcentaje de progreso
  const getProgressPercentage = () => {
    if (job.status === 'completed') return 100;
    if (['failed', 'cancelled'].includes(job.status)) return 0;
    return job.progress || 0;
  };

  // Formatear tiempo en segundos a hh:mm:ss
  const formatTime = (seconds) => {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  // Formatear tamaño de archivo
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  // Obtener color según el estado
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

  // Obtener texto según el estado
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

  // Manejar descarga de archivo
  const handleDownload = async (e) => {
    e.preventDefault();

    // Evitar múltiples descargas
    if (isDownloaded || isDownloading) {
      return;
    }

    // Iniciar descarga
    setIsDownloading(true);

    // Realizar petición de descarga
    try {
      const sessionId = localStorage.getItem('sessionId');
      
      // Construir URL de descarga fixeado para funcionar tanto en local como en "producción"
      const API_URL = process.env.REACT_APP_API_URL || globalThis.location.origin;
      const downloadUrl = `${API_URL}/api/download/${job.id}`;
      
      console.log('Descargando desde:', downloadUrl);

      const response = await fetch(downloadUrl, {
        headers: {
          'x-session-id': sessionId
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Error al descargar el archivo');
      }

      console.log('Respuesta OK, obteniendo blob...');
      const blob = await response.blob();
      console.log('Blob recibido:', blob.size, 'bytes');

      if (blob.size === 0) {
        throw new Error('El archivo descargado está vacío');
      }

      const url = URL.createObjectURL(blob);

      // Crear y hacer click en el enlace de manera más limpia
      const link = document.createElement('a');
      link.href = url;
      link.download = job.outputName || `video_${job.id}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      // Limpiar después de un pequeño delay
      setTimeout(() => {
        URL.revokeObjectURL(url);
        console.log('Descarga completada y limpieza realizada');
      }, 100);

      onDownload(job.id);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert(`Error al descargar el archivo: ${error.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const progress = getProgressPercentage();
  const statusColor = getStatusColor();
  const canCancel = job.status === 'queued' || job.status === 'processing';
  const isCompleted = job.status === 'completed';
  const isProcessing = job.status === 'processing';

  const getDownloadButtonText = () => {
    if (isDownloading) return '⏳ Descargando...';
    if (isDownloaded) return '✓ Descargado';
    return '📥 Descargar';
  };

  // Renderizar componente
  return (
    <div className="progress-card" data-status={job.status}>
      {/* Encabezado */}
      <div className="progress-header">
        <div className="progress-info">
          <h4 className="progress-title">
            {job.inputName || job.filename || 'Video'}
          </h4>
          <span className="progress-status" style={{ color: statusColor }}>
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

      {/* Barra de Progreso */}
      <div className="progress-bar-container">
        <div className="progress-bar-track">
          <div
            className="progress-bar-fill"
            style={{
              width: `${progress}%`,
              backgroundColor: statusColor
            }}
          />
        </div>
        <span className="progress-percentage">
          {progress.toFixed(1)}%
        </span>
      </div>

      {/* Detalles del Progreso */}
      {(isProcessing || isCompleted) && (
        <div className="progress-details">
          {isProcessing && job.fps && (
            <div className="detail-item">
              <span className="detail-label">FPS:</span>
              <span className="detail-value">{Number.parseFloat(job.fps).toFixed(2)}</span>
            </div>
          )}

          {isProcessing && job.speed && (
            <div className="detail-item">
              <span className="detail-label">Velocidad:</span>
              <span className="detail-value">{job.speed}</span>
            </div>
          )}

          {isCompleted && job.result?.outputSize && (
            <div className="detail-item">
              <span className="detail-label">Tamaño:</span>
              <span className="detail-value">{formatFileSize(job.result.outputSize)}</span>
            </div>
          )}

          {isCompleted && job.result?.processingTime && (
            <div className="detail-item">
              <span className="detail-label">Tiempo:</span>
              <span className="detail-value">
                {formatTime(job.result.processingTime / 1000)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Botón de Descarga */}
      {isCompleted && job.result && (
        <div className="progress-actions">
          <button
            onClick={handleDownload}
            className={`btn-action btn-download ${isDownloaded ? 'downloaded' : ''}`}
            disabled={isDownloaded || isDownloading}
            title={isDownloaded ? 'Archivo ya descargado' : 'Descargar archivo'}
          >
            {getDownloadButtonText()}
          </button>
        </div>
      )}

      {/* Mensaje de Error */}
      {job.error && (
        <div className="progress-error">
          <span className="error-icon">⚠️</span>
          <span className="progress-error-message">{job.error}</span>
        </div>
      )}
    </div>
  );
};

ProgressBar.propTypes = {
  job: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    status: PropTypes.string.isRequired,
    progress: PropTypes.number,
    inputName: PropTypes.string,
    filename: PropTypes.string,
    outputName: PropTypes.string,
    fps: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    speed: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    result: PropTypes.shape({
      outputSize: PropTypes.number,
      processingTime: PropTypes.number
    }),
    error: PropTypes.string
  }).isRequired,
  onCancel: PropTypes.func.isRequired,
  onDownload: PropTypes.func.isRequired,
  isDownloaded: PropTypes.bool.isRequired
};

export default ProgressBar;

