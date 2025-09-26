import { useEffect, useState } from "react";

export default function ProgressBar({ jobId }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const evtSource = new EventSource(`http://localhost:3000/progress/${jobId}`);
    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setProgress(data.percent || 0);
      if (data.percent >= 100) evtSource.close();
    };
    return () => evtSource.close();
  }, [jobId]);

  return (
    <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
      <div
        className="bg-green-500 h-4 transition-all"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};
