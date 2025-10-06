import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';

const ProgressBar = ({ job: initialJob, onCancel, serverUrl = 'http://localhost:3000' }) => {
  const [job, setJob] = useState(initialJob);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const newSocket = io(serverUrl);
    setSocket(newSocket);

    if (job?.id) {
      newSocket.emit('subscribe', job.id);

      newSocket.on('job:update', (updatedJob) => {
        if (updatedJob.jobId === job.id || updatedJob.id === job.id) {
          setJob(prev => ({
            ...prev,
            ...updatedJob,
            status: updatedJob.status,
            progress: updatedJob.progress || 0,
            currentTime: updatedJob.currentTime,
            fps: updatedJob.fps,
            speed: updatedJob.speed,
            error: updatedJob.error,
            result: updatedJob.result
          }));
        }
      });

      newSocket.on('conversion:progress', (data) => {
        if (data.jobId === job.id) {
          setJob(prev => ({
            ...prev,
            progress: data.progress,
            currentTime: data.currentTime,
            fps: data.fps,
            speed: data.speed
          }));
        }
      });
    }

    return () => {
      if (job?.id) newSocket.emit('unsubscribe', job.id);
      newSocket.disconnect();
    };
  }, [job?.id, serverUrl]);

  useEffect(() => setJob(initialJob), [initialJob]);

  const getProgressPercentage = () => {
    if (job?.status === 'completed') return 100;
    if (['failed', 'cancelled'].includes(job?.status)) return 0;
    return job?.progress || 0;
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getStatusColor = () => {
    switch (job?.status) {
      case 'queued': return '#ffa500';
      case 'processing': return '#4CAF50';
      case 'completed': return '#2196F3';
      case 'failed': return '#f44336';
      case 'cancelled': return '#9e9e9e';
      default: return '#757575';
    }
  };

  const getStatusText = () => {
    switch (job?.status) {
      case 'queued': return 'En Cola';
      case 'processing': return 'Procesando';
      case 'completed': return 'Completado';
      case 'failed': return 'Fallido';
      case 'cancelled': return 'Cancelado';
      default: return 'Desconocido';
    }
  };

  const handleCancel = () => onCancel && onCancel(job.id);

  if (!job) return <div>Cargando...</div>;

  const progress = getProgressPercentage();
  const statusColor = getStatusColor();

  return (
    <div className="bg-white rounded-lg p-5 mb-4 shadow-md animate-fade-in">
      {/* Encabezado */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex flex-col">
          <h4 className="text-lg font-semibold text-gray-800 break-words mb-1">
            {job.inputName || job.filename || 'Video'}
          </h4>
          <span className="text-sm font-medium uppercase tracking-wide" style={{ color: statusColor }}>
            {getStatusText()}
          </span>
        </div>

        {(job.status === 'queued' || job.status === 'processing') && (
          <button
            onClick={handleCancel}
            title="Cancelar trabajo"
            className="bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg transition-transform duration-200 hover:scale-110"
          >
            ✕
          </button>
        )}
      </div>

      {/* Barra de Progreso */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-6 bg-gray-300 rounded-full overflow-hidden relative">
          <div
            className="h-full rounded-full animate-strip"
            style={{
              width: `${progress}%`,
              backgroundColor: statusColor,
              transition: job.status === 'processing' ? 'width 0.5s ease' : 'none'
            }}
          />
        </div>
        <span className="text-sm font-semibold text-gray-700 min-w-[50px] text-right">
          {progress.toFixed(1)}%
        </span>
      </div>

      {/* Detalles */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 text-sm mt-3">
        {job.currentTime && (
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Tiempo:</span>
            <span className="text-gray-800 font-semibold">{job.currentTime}</span>
          </div>
        )}
        {job.fps && (
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">FPS:</span>
            <span className="text-gray-800 font-semibold">{parseFloat(job.fps).toFixed(2)}</span>
          </div>
        )}
        {job.speed && (
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Velocidad:</span>
            <span className="text-gray-800 font-semibold">{job.speed}x</span>
          </div>
        )}
        {job.result?.outputSize && (
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Tamaño:</span>
            <span className="text-gray-800 font-semibold">{formatFileSize(job.result.outputSize)}</span>
          </div>
        )}
        {job.result?.processingTime && (
          <div className="flex justify-between">
            <span className="text-gray-600 font-medium">Tiempo Total:</span>
            <span className="text-gray-800 font-semibold">
              {formatTime(job.result.processingTime / 1000)}
            </span>
          </div>
        )}
      </div>

      {/* Acciones */}
      {job.status === 'completed' && job.result && (
        <div className="flex gap-3 mt-4">
          <a
            href={`${serverUrl}/api/download/${job.id}`}
            className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md font-medium text-sm transition-transform hover:-translate-y-0.5 flex items-center gap-2"
            download
          >
            📥 Descargar
          </a>
          {job.result.thumbnailPath && (
            <a
              href={`${serverUrl}/api/stream/${job.id}`}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md font-medium text-sm transition-transform hover:-translate-y-0.5 flex items-center gap-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              ▶️ Vista Previa
            </a>
          )}
        </div>
      )}

      {/* Error */}
      {job.error && (
        <div className="mt-3 p-3 bg-red-50 rounded-md flex items-center gap-2 animate-shake">
          <span className="text-red-600 text-lg">⚠️</span>
          <span className="text-red-700 text-sm font-medium">{job.error}</span>
        </div>
      )}
    </div>
  );
};

export default ProgressBar;
