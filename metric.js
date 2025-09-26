const { exec } = require("child_process");

function runMetrics(original, converted) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -i "${converted}" -i "${original}" -lavfi "[0:v][1:v]ssim;[0:v][1:v]psnr;[0:v][1:v]libvmaf=model_path=/usr/share/model/vmaf_v0.6.1.pkl" -f null - 2>&1`;

    exec(cmd, (error, stdout) => {
      if (error) return reject(error);

      // Extraer métricas de la salida
      const ssimMatch = stdout.match(/All:(\d+\.\d+)/);
      const psnrMatch = stdout.match(/average:(\d+\.\d+)/);
      const vmafMatch = stdout.match(/VMAF score: (\d+\.\d+)/);

      resolve({
        ssim: ssimMatch ? parseFloat(ssimMatch[1]) : null,
        psnr: psnrMatch ? parseFloat(psnrMatch[1]) : null,
        vmaf: vmafMatch ? parseFloat(vmafMatch[1]) : null
      });
    });
  });
}

module.exports = { runMetrics };
