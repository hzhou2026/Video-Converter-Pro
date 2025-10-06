import React, { useState } from 'react';

const ResultsTable = ({ jobs }) => {
  const [sortBy, setSortBy] = useState('completedAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filterStatus, setFilterStatus] = useState('all');

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
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

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const calculateCompressionRate = (inputSize, outputSize) => {
    if (!inputSize || !outputSize) return 0;
    return (((inputSize - outputSize) / inputSize) * 100).toFixed(1);
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const handleDownload = async (jobId, filename) => {
    try {
      const response = await fetch(`http://localhost:3000/api/download/${jobId}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Error al descargar el archivo');
    }
  };

  const filteredJobs = jobs.filter(job => {
    if (filterStatus === 'all') return true;
    return job.status === filterStatus;
  });

  const sortedJobs = [...filteredJobs].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    if (sortBy === 'completedAt' || sortBy === 'createdAt') {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
    }

    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const getStatusBadge = (status) => {
    const colors = {
      completed: '#4CAF50',
      failed: '#f44336',
      cancelled: '#9e9e9e'
    };

    const labels = {
      completed: 'Completado',
      failed: 'Fallido',
      cancelled: 'Cancelado'
    };

    return (
      <span style={{
        padding: '4px 12px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '600',
        color: 'white',
        display: 'inline-block',
        backgroundColor: colors[status] || '#757575'
      }}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      padding: '20px',
      marginTop: '20px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ fontWeight: '600', color: '#333' }}>Filtrar:</label>
          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            <option value="all">Todos</option>
            <option value="completed">Completados</option>
            <option value="failed">Fallidos</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </div>

        <div style={{ color: '#666', fontSize: '14px', fontWeight: '500' }}>
          {sortedJobs.length} trabajo{sortedJobs.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse'
        }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th onClick={() => handleSort('filename')} style={{
                padding: '12px',
                textAlign: 'left',
                fontWeight: '600',
                color: '#333',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap'
              }}>
                Archivo {sortBy === 'filename' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('status')} style={{
                padding: '12px',
                textAlign: 'left',
                fontWeight: '600',
                color: '#333',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap'
              }}>
                Estado {sortBy === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('inputSize')} style={{
                padding: '12px',
                textAlign: 'left',
                fontWeight: '600',
                color: '#333',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap'
              }}>
                Tamaño Original {sortBy === 'inputSize' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('outputSize')} style={{
                padding: '12px',
                textAlign: 'left',
                fontWeight: '600',
                color: '#333',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap'
              }}>
                Tamaño Final {sortBy === 'outputSize' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th style={{
                padding: '12px',
                textAlign: 'left',
                fontWeight: '600',
                color: '#333',
                whiteSpace: 'nowrap'
              }}>
                Compresión
              </th>
              <th onClick={() => handleSort('processingTime')} style={{
                padding: '12px',
                textAlign: 'left',
                fontWeight: '600',
                color: '#333',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap'
              }}>
                Tiempo {sortBy === 'processingTime' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('completedAt')} style={{
                padding: '12px',
                textAlign: 'left',
                fontWeight: '600',
                color: '#333',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap'
              }}>
                Fecha {sortBy === 'completedAt' && (sortOrder === 'asc' ? '↑' : '↓')}
              </th>
              <th style={{
                padding: '12px',
                textAlign: 'left',
                fontWeight: '600',
                color: '#333',
                whiteSpace: 'nowrap'
              }}>
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedJobs.length === 0 ? (
              <tr>
                <td colSpan="8" style={{
                  textAlign: 'center',
                  padding: '40px',
                  color: '#999'
                }}>
                  No hay resultados para mostrar
                </td>
              </tr>
            ) : (
              sortedJobs.map((job, index) => (
                <tr key={job.id || job.jobId || index} style={{
                  borderBottom: '1px solid #e0e0e0',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f9f9f9'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                  <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '20px' }}>🎬</span>
                      <span style={{ fontWeight: '500', color: '#333' }}>
                        {job.filename || job.inputFile || 'Video sin nombre'}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '12px' }}>{getStatusBadge(job.status)}</td>
                  <td style={{ padding: '12px' }}>{formatFileSize(job.inputSize)}</td>
                  <td style={{ padding: '12px' }}>{formatFileSize(job.outputSize)}</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ color: '#4CAF50', fontWeight: '600' }}>
                      {calculateCompressionRate(job.inputSize, job.outputSize)}%
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>{formatDuration(job.processingTime)}</td>
                  <td style={{ padding: '12px' }}>{formatDate(job.completedAt || job.createdAt)}</td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {job.status === 'completed' && (
                        <button
                          onClick={() => handleDownload(job.id || job.jobId, job.outputFile || 'video.mp4')}
                          title="Descargar"
                          style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '20px',
                            cursor: 'pointer',
                            padding: '4px',
                            transition: 'transform 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        >
                          ⬇️
                        </button>
                      )}
                      {job.metrics && (
                        <button
                          onClick={() => alert(`Métricas:\nPSNR: ${job.metrics.psnr}\nSSIM: ${job.metrics.ssim}\nVMAF: ${job.metrics.vmaf}`)}
                          title="Ver métricas"
                          style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '20px',
                            cursor: 'pointer',
                            padding: '4px',
                            transition: 'transform 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        >
                          📊
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResultsTable;