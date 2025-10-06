import React, { useState, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const MetricsChart = ({ jobs }) => {
  const [chartType, setChartType] = useState('compression');
  const [timeRange, setTimeRange] = useState('all');

  const filterJobsByTimeRange = (jobs) => {
    if (timeRange === 'all') return jobs;
    
    const now = new Date();
    const ranges = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };

    return jobs.filter(job => {
      const jobDate = new Date(job.completedAt || job.createdAt);
      return now - jobDate <= ranges[timeRange];
    });
  };

  const filteredJobs = filterJobsByTimeRange(jobs);

  const compressionData = useMemo(() => {
    return filteredJobs.map((job, index) => ({
      name: `Job ${index + 1}`,
      filename: job.filename?.substring(0, 20) || `Video ${index + 1}`,
      original: Math.round(job.inputSize / 1024 / 1024 * 100) / 100,
      compressed: Math.round(job.outputSize / 1024 / 1024 * 100) / 100,
      reduction: Math.round((1 - job.outputSize / job.inputSize) * 100)
    }));
  }, [filteredJobs]);

  const processingTimeData = useMemo(() => {
    return filteredJobs.map((job, index) => ({
      name: `Job ${index + 1}`,
      filename: job.filename?.substring(0, 20) || `Video ${index + 1}`,
      time: Math.round(job.processingTime / 60 * 100) / 100,
      fps: job.avgFps || 0
    }));
  }, [filteredJobs]);

  const qualityMetricsData = useMemo(() => {
    return filteredJobs
      .filter(job => job.metrics)
      .map((job, index) => ({
        name: `Job ${index + 1}`,
        filename: job.filename?.substring(0, 20) || `Video ${index + 1}`,
        psnr: job.metrics?.psnr || 0,
        ssim: (job.metrics?.ssim || 0) * 100,
        vmaf: job.metrics?.vmaf || 0
      }));
  }, [filteredJobs]);

  const statsData = useMemo(() => {
    const totalOriginalSize = filteredJobs.reduce((sum, job) => sum + (job.inputSize || 0), 0);
    const totalCompressedSize = filteredJobs.reduce((sum, job) => sum + (job.outputSize || 0), 0);
    const totalProcessingTime = filteredJobs.reduce((sum, job) => sum + (job.processingTime || 0), 0);
    const avgCompressionRate = filteredJobs.length > 0 
      ? (1 - totalCompressedSize / totalOriginalSize) * 100 
      : 0;

    return {
      totalJobs: filteredJobs.length,
      totalOriginalSize: (totalOriginalSize / 1024 / 1024 / 1024).toFixed(2),
      totalCompressedSize: (totalCompressedSize / 1024 / 1024 / 1024).toFixed(2),
      totalSaved: ((totalOriginalSize - totalCompressedSize) / 1024 / 1024 / 1024).toFixed(2),
      avgCompressionRate: avgCompressionRate.toFixed(1),
      totalProcessingTime: Math.round(totalProcessingTime / 60),
      avgProcessingTime: filteredJobs.length > 0 
        ? Math.round(totalProcessingTime / filteredJobs.length / 60) 
        : 0
    };
  }, [filteredJobs]);

  const CustomTooltipCompression = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          background: 'white',
          padding: '12px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          <p style={{ margin: 0, fontWeight: 'bold', marginBottom: '8px' }}>
            {payload[0].payload.filename}
          </p>
          <p style={{ margin: '4px 0', color: '#8884d8' }}>
            Original: {payload[0].value} MB
          </p>
          <p style={{ margin: '4px 0', color: '#82ca9d' }}>
            Comprimido: {payload[1].value} MB
          </p>
          <p style={{ margin: '4px 0', color: '#ffc658', fontWeight: 'bold' }}>
             Reducción: {payload[0].payload.reduction}%
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomTooltipProcessing = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          background: 'white',
          padding: '12px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          <p style={{ margin: 0, fontWeight: 'bold', marginBottom: '8px' }}>
            {payload[0].payload.filename}
          </p>
          <p style={{ margin: '4px 0', color: '#8884d8' }}>
             Tiempo: {payload[0].value} min
          </p>
          {payload[1] && (
            <p style={{ margin: '4px 0', color: '#82ca9d' }}>
              FPS promedio: {payload[1].value.toFixed(2)}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const CustomTooltipQuality = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          background: 'white',
          padding: '12px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          <p style={{ margin: 0, fontWeight: 'bold', marginBottom: '8px' }}>
            {payload[0].payload.filename}
          </p>
          {payload.map((entry, index) => (
            <p key={index} style={{ margin: '4px 0', color: entry.color }}>
              {entry.name}: {entry.value.toFixed(2)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const charts = {
    compression: (
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={compressionData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis label={{ value: 'Tamaño (MB)', angle: -90, position: 'insideLeft' }} />
          <Tooltip content={<CustomTooltipCompression />} />
          <Legend />
          <Bar dataKey="original" fill="#8884d8" name="Tamaño Original" />
          <Bar dataKey="compressed" fill="#82ca9d" name="Tamaño Comprimido" />
        </BarChart>
      </ResponsiveContainer>
    ),
    processing: (
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={processingTimeData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis yAxisId="left" label={{ value: 'Tiempo (min)', angle: -90, position: 'insideLeft' }} />
          <YAxis yAxisId="right" orientation="right" label={{ value: 'FPS', angle: 90, position: 'insideRight' }} />
          <Tooltip content={<CustomTooltipProcessing />} />
          <Legend />
          <Line yAxisId="left" type="monotone" dataKey="time" stroke="#8884d8" strokeWidth={2} name="Tiempo de Procesamiento" />
          <Line yAxisId="right" type="monotone" dataKey="fps" stroke="#82ca9d" strokeWidth={2} name="FPS Promedio" />
        </LineChart>
      </ResponsiveContainer>
    ),
    quality: (
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={qualityMetricsData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis domain={[0, 100]} />
          <Tooltip content={<CustomTooltipQuality />} />
          <Legend />
          <Line type="monotone" dataKey="psnr" stroke="#8884d8" strokeWidth={2} name="PSNR" />
          <Line type="monotone" dataKey="ssim" stroke="#82ca9d" strokeWidth={2} name="SSIM (%)" />
          <Line type="monotone" dataKey="vmaf" stroke="#ffc658" strokeWidth={2} name="VMAF" />
        </LineChart>
      </ResponsiveContainer>
    )
  };

  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      padding: '24px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px'
      }}>
        <h2 style={{ margin: 0, color: '#333' }}>Análisis de Métricas</h2>
        <select 
          value={timeRange} 
          onChange={(e) => setTimeRange(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #ddd',
            borderRadius: '6px',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          <option value="all">Todo el tiempo</option>
          <option value="24h">Últimas 24 horas</option>
          <option value="7d">Últimos 7 días</option>
          <option value="30d">Últimos 30 días</option>
        </select>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '24px'
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '12px',
          padding: '20px',
          color: 'white'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📊</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '4px' }}>
            {statsData.totalJobs}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.9 }}>Trabajos Completados</div>
        </div>
        
        <div style={{
          background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
          borderRadius: '12px',
          padding: '20px',
          color: 'white'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>💾</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '4px' }}>
            {statsData.totalSaved} GB
          </div>
          <div style={{ fontSize: '14px', opacity: 0.9 }}>Espacio Ahorrado</div>
        </div>
        
        <div style={{
          background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
          borderRadius: '12px',
          padding: '20px',
          color: 'white'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📉</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '4px' }}>
            {statsData.avgCompressionRate}%
          </div>
          <div style={{ fontSize: '14px', opacity: 0.9 }}>Compresión Promedio</div>
        </div>
        
        <div style={{
          background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
          borderRadius: '12px',
          padding: '20px',
          color: 'white'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏱️</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '4px' }}>
            {statsData.avgProcessingTime} min
          </div>
          <div style={{ fontSize: '14px', opacity: 0.9 }}>Tiempo Promedio</div>
        </div>
      </div>

      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '20px',
        borderBottom: '2px solid #e0e0e0',
        paddingBottom: '8px'
      }}>
        <button
          onClick={() => setChartType('compression')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: chartType === 'compression' ? '#667eea' : 'none',
            color: chartType === 'compression' ? 'white' : '#666',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            borderRadius: '6px 6px 0 0',
            transition: 'all 0.3s'
          }}
        >
          Compresión
        </button>
        <button
          onClick={() => setChartType('processing')}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: chartType === 'processing' ? '#667eea' : 'none',
            color: chartType === 'processing' ? 'white' : '#666',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            borderRadius: '6px 6px 0 0',
            transition: 'all 0.3s'
          }}
        >
          Procesamiento
        </button>
        <button
          onClick={() => setChartType('quality')}
          disabled={qualityMetricsData.length === 0}
          style={{
            padding: '10px 20px',
            border: 'none',
            background: chartType === 'quality' ? '#667eea' : 'none',
            color: chartType === 'quality' ? 'white' : '#666',
            fontSize: '14px',
            fontWeight: '600',
            cursor: qualityMetricsData.length === 0 ? 'not-allowed' : 'pointer',
            borderRadius: '6px 6px 0 0',
            opacity: qualityMetricsData.length === 0 ? 0.4 : 1,
            transition: 'all 0.3s'
          }}
        >
          Calidad
        </button>
      </div>

      <div style={{ minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {filteredJobs.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', padding: '60px 20px' }}>
            <p style={{ margin: 0, fontSize: '16px' }}>
              No hay datos suficientes para mostrar métricas
            </p>
          </div>
        ) : (
          charts[chartType]
        )}
      </div>
    </div>
  );
};

export default MetricsChart;