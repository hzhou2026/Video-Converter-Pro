import { useState } from 'react';
import VideoUploader from './components/VideoUploader';
import ConversionOptions from './components/ConversionOptions';
import JobsList from './components/JobsList';
import Statistics from './components/Statistics';
import { motion } from 'framer-motion';

function App() {
  const [activeJobs, setActiveJobs] = useState([]);
  const [completedJobs, setCompletedJobs] = useState([]);

  const handleNewJob = (job) => {
    setActiveJobs(prev => [...prev, job]);
  };

  const handleJobComplete = (jobId) => {
    const job = activeJobs.find(j => j.id === jobId);
    if (job) {
      setActiveJobs(prev => prev.filter(j => j.id !== jobId));
      setCompletedJobs(prev => [...prev, { ...job, completedAt: new Date() }]);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-5xl font-bold text-white mb-4">
            🎬 Video Converter Pro
          </h1>
          <p className="text-gray-300 text-lg">
            Advanced video conversion with real-time processing
          </p>
        </motion.header>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <VideoUploader onJobCreated={handleNewJob} />
            <JobsList 
              activeJobs={activeJobs} 
              completedJobs={completedJobs}
              onJobComplete={handleJobComplete}
            />
          </div>
          <div className="space-y-6">
            <ConversionOptions />
            <Statistics 
              activeCount={activeJobs.length}
              completedCount={completedJobs.length}
            />
          </div>
        </div>
      </div>
    </div>
  );
}