import { useState } from "react";
import UploadForm from "../componentes/UploadForm";
import ProgressBar from "../componentes/ProgressBar";
import ResultsTable from "../componentes/ResultsTable";
import MetricsChart from "../componentes/MetricsChart";

export default function Dashboard() {
  const [jobs, setJobs] = useState([]);

  return (
    <div className="space-y-6">
      <UploadForm onNewJob={(job) => setJobs([...jobs, job])} />
      {jobs.map((job, i) => (
        <div key={i} className="p-4 bg-white shadow rounded-xl space-y-4">
          <h2 className="font-bold">Job ID: {job.id}</h2>
          <ProgressBar jobId={job.id} />
          {job.metrics && <ResultsTable results={job} />}
          {job.metrics && <MetricsChart metrics={job.metrics} />}
        </div>
      ))}
    </div>
  );
};
