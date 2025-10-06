import React, { useEffect, useState } from 'react';

const Dashboard = ({ jobs, systemHealth, onRefresh }) => {
  const [recentActivity, setRecentActivity] = useState([]);

  useEffect(() => {
    const sorted = [...jobs]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);
    setRecentActivity(sorted);
  }, [jobs]);

  const stats = {
    total: jobs.length,
    queued: jobs.filter(j => j.status === 'queued').length,
    processing: jobs.filter(j => j.status === 'processing').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length,
    cancelled: jobs.filter(j => j.status === 'cancelled').length
  };

  const successRate = stats.total > 0
    ? ((stats.completed / stats.total) * 100).toFixed(1)
    : 0;

  const formatTime = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return `Hace ${diff}s`;
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)}h`;
    return `Hace ${Math.floor(diff / 86400)}d`;
  };

  const getStatusColor = (status) => {
    const colors = {
      queued: '#ffa500',
      processing: '#2196F3',
      completed: '#4CAF50',
      failed: '#f44336',
      cancelled: '#9e9e9e'
    };
    return colors[status] || '#757575';
  };

  const getStatusEmoji = (status) => {
    const emojis = {
      queued: '⏳',
      processing: '⚙️',
      completed: '✅',
      failed: '❌',
      cancelled: '🚫'
    };
    return emojis[status] || '❓';
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-semibold text-gray-800">Panel de Control</h2>
        <button
          onClick={onRefresh}
          className="px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-semibold text-sm transition-colors"
        >
          🔄 Actualizar
        </button>
      </div>

      {/* System Health */}
      <div className="bg-white rounded-xl p-6 mb-6 shadow-md">
        <h3 className="text-xl font-semibold text-gray-800 mb-5">Estado del Sistema</h3>
        {systemHealth ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-5">
            <div className="text-center">
              <div className="text-gray-600 text-sm mb-2">Estado</div>
              <div className={`text-2xl font-bold ${
                systemHealth.status === 'healthy'
                  ? 'text-green-600'
                  : systemHealth.status === 'degraded'
                  ? 'text-amber-500'
                  : 'text-red-600'
              }`}>
                {systemHealth.status === 'healthy' ? '🟢 Operativo' : '🔴 Con Problemas'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-gray-600 text-sm mb-2">CPU</div>
              <div className="text-2xl font-bold text-gray-800">
                {systemHealth.cpu ? `${systemHealth.cpu.toFixed(1)}%` : 'N/A'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-gray-600 text-sm mb-2">Memoria</div>
              <div className="text-2xl font-bold text-gray-800">
                {systemHealth.memory ? `${systemHealth.memory.toFixed(1)}%` : 'N/A'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-gray-600 text-sm mb-2">Trabajos Activos</div>
              <div className="text-2xl font-bold text-gray-800">
                {systemHealth.activeJobs || stats.processing + stats.queued}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-center text-gray-500 py-4">Cargando información del sistema...</p>
        )}
      </div>

      {/* Stats */}
      <div className="bg-white rounded-xl p-6 mb-6 shadow-md">
        <h3 className="text-xl font-semibold text-gray-800 mb-5">Estadísticas Generales</h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 mb-6">
          <div className="text-center text-white rounded-lg p-5 bg-gradient-to-r from-indigo-500 to-purple-600">
            <div className="text-4xl font-bold mb-2">{stats.total}</div>
            <div className="text-sm opacity-90">Total de Trabajos</div>
          </div>
          <div className="text-center text-white rounded-lg p-5 bg-gradient-to-r from-green-500 to-green-600">
            <div className="text-4xl font-bold mb-2">{stats.completed}</div>
            <div className="text-sm opacity-90">Completados</div>
          </div>
          <div className="text-center text-white rounded-lg p-5 bg-gradient-to-r from-amber-400 to-amber-600">
            <div className="text-4xl font-bold mb-2">{stats.processing + stats.queued}</div>
            <div className="text-sm opacity-90">En Proceso</div>
          </div>
          <div className="text-center text-white rounded-lg p-5 bg-gradient-to-r from-red-500 to-red-600">
            <div className="text-4xl font-bold mb-2">{stats.failed}</div>
            <div className="text-sm opacity-90">Fallidos</div>
          </div>
        </div>

        <div>
          <div className="font-semibold text-gray-800 mb-2">Tasa de Éxito</div>
          <div className="h-[30px] bg-gray-300 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-600 flex items-center justify-end text-white font-semibold px-3 transition-[width] duration-500 ease-out"
              style={{ width: `${successRate}%` }}
            >
              <span>{successRate}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl p-6 mb-6 shadow-md">
        <h3 className="text-xl font-semibold text-gray-800 mb-5">Actividad Reciente</h3>
        {recentActivity.length === 0 ? (
          <p className="text-center text-gray-500 py-6">No hay actividad reciente</p>
        ) : (
          <div className="flex flex-col gap-3">
            {recentActivity.map((job) => (
              <div
                key={job.id || job.jobId}
                className="flex items-center p-4 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <div className="text-2xl mr-4">{getStatusEmoji(job.status)}</div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-800 mb-1">
                    {job.filename || job.inputFile || 'Video sin nombre'}
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span
                      className="font-semibold uppercase text-xs"
                      style={{ color: getStatusColor(job.status) }}
                    >
                      {job.status}
                    </span>
                    <span className="text-gray-500">{formatTime(job.createdAt)}</span>
                  </div>
                </div>
                {job.progress !== undefined && job.status === 'processing' && (
                  <div className="text-indigo-500 font-bold text-lg">
                    {job.progress.toFixed(0)}%
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl p-6 shadow-md">
        <h3 className="text-xl font-semibold text-gray-800 mb-5">Acciones Rápidas</h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          <button
            onClick={() => (window.location.hash = '#upload')}
            className="p-4 bg-gray-100 border-2 border-gray-200 rounded-lg font-semibold text-gray-700 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 transition-transform hover:-translate-y-0.5"
          >
            📤 Subir Video
          </button>
          <button
            onClick={() => (window.location.hash = '#jobs')}
            className="p-4 bg-gray-100 border-2 border-gray-200 rounded-lg font-semibold text-gray-700 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 transition-transform hover:-translate-y-0.5"
          >
            ⚙️ Ver Trabajos
          </button>
          <button
            onClick={() => (window.location.hash = '#metrics')}
            className="p-4 bg-gray-100 border-2 border-gray-200 rounded-lg font-semibold text-gray-700 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 transition-transform hover:-translate-y-0.5"
          >
            📊 Ver Métricas
          </button>
          <button
            onClick={onRefresh}
            className="p-4 bg-gray-100 border-2 border-gray-200 rounded-lg font-semibold text-gray-700 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 transition-transform hover:-translate-y-0.5"
          >
            🔄 Actualizar Todo
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
