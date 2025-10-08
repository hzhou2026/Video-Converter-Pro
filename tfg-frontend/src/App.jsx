import React, { useState, useEffect } from 'react';
import UploadForm from './componentes/UploadForm';
import ProgressBar from './componentes/ProgressBar';
import ResultsTable from './componentes/ResultsTable';
import MetricsChart from './componentes/MetricsChart';
import Dashboard from './pages/Dashboard';
import { useSocket } from './hooks/useSocket';
import { api } from './servicios/api';
import './App.css';

// Configuración de tabs
const TABS = [
  { key: 'upload', label: 'Subir y Convertir', icon: '📤' },
  { key: 'jobs', label: 'Trabajos', icon: '⚙️' },
  { key: 'metrics', label: 'Métricas', icon: '📊' },
  { key: 'dashboard', label: 'Dashboard', icon: '🎛️' }
];

function App() {
  const socket = useSocket('http://localhost:3000');
  const [jobs, setJobs] = useState([]);
  const [activeTab, setActiveTab] = useState('upload');
  const [presets, setPresets] = useState({});
  const [formats, setFormats] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);

  // Cargar datos iniciales
  useEffect(() => {
    loadInitialData();
  }, []);

  // Configurar listeners de socket
  useEffect(() => {
    if (socket) {
      socket.on('job:update', handleJobUpdate);
      return () => {
        socket.off('job:update', handleJobUpdate);
      };
    }
  }, [socket]);

  const loadInitialData = async () => {
    try {
      const [presetsData, formatsData, jobsData, healthData] = await Promise.all([
        api.fetchPresets(),
        api.fetchFormats(),
        api.fetchJobs(),
        api.fetchSystemHealth()
      ]);
      
      setPresets(presetsData);
      setFormats(formatsData);
      setJobs(jobsData);
      setSystemHealth(healthData);
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
  };

  const handleJobUpdate = (updatedJob) => {
    setJobs(prevJobs =>
      prevJobs.map(job =>
        job.id === updatedJob.id ? updatedJob : job
      )
    );
  };

  const handleJobCreated = (job) => {
    setJobs(prevJobs => [job, ...prevJobs]);
    if (socket) {
      socket.emit('subscribe', job.jobId);
    }
  };

  const handleJobCancel = async (jobId) => {
    try {
      await api.cancelJob(jobId);
      setJobs(prevJobs =>
        prevJobs.map(job =>
          job.id === jobId ? { ...job, status: 'cancelled' } : job
        )
      );
    } catch (error) {
      console.error('Error cancelling job:', error);
    }
  };

  const refreshData = async () => {
    try {
      const [jobsData, healthData] = await Promise.all([
        api.fetchJobs(),
        api.fetchSystemHealth()
      ]);
      setJobs(jobsData);
      setSystemHealth(healthData);
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };

  const activeJobs = jobs.filter(job => ['queued', 'processing'].includes(job.status));
  const completedJobs = jobs.filter(job => ['completed', 'failed', 'cancelled'].includes(job.status));
  const finishedJobs = jobs.filter(job => job.status === 'completed');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'upload':
        return (
          <UploadForm
            presets={presets}
            formats={formats}
            onJobCreated={handleJobCreated}
          />
        );
      
      case 'jobs':
        return (
          <div className="jobs-section">
            <div className="jobs-header">
              <h2>Trabajos de Conversión</h2>
              <button onClick={refreshData} className="btn-refresh">
                Actualizar
              </button>
            </div>
            {jobs.length === 0 ? (
              <div className="no-jobs">
                <p>No hay trabajos de conversión</p>
              </div>
            ) : (
              <>
                {activeJobs.map(job => (
                  <ProgressBar
                    key={job.id}
                    job={job}
                    onCancel={() => handleJobCancel(job.id)}
                  />
                ))}
                <ResultsTable jobs={completedJobs} />
              </>
            )}
          </div>
        );
      
      case 'metrics':
        return <MetricsChart jobs={finishedJobs} />;
      
      case 'dashboard':
        return (
          <Dashboard
            jobs={jobs}
            systemHealth={systemHealth}
            onRefresh={refreshData}
          />
        );
      
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>Video Converter Pro</h1>
          <div className="header-subtitle">
            Sistema Avanzado de Conversión de Video - TFG
          </div>
        </div>
        <div className="system-status">
          {systemHealth && (
            <div className={`status-indicator ${systemHealth.status}`}>
              <span className="status-dot"></span>
              Sistema {systemHealth.status === 'healthy' ? 'Operativo' : 'Con Problemas'}
            </div>
          )}
        </div>
      </header>

      <nav className="app-nav">
        <div className="nav-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`nav-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <span className="tab-icon">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="app-main">
        <div className="content-container">
          {renderTabContent()}
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <p>Video Converter Pro - Trabajo Final de Grado</p>
          <div className="footer-stats">
            <span>Trabajos Activos: {activeJobs.length}</span>
            <span>Trabajos Completados: {finishedJobs.length}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;