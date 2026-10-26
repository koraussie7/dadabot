/**
 * System Resources Detection Utility
 * GPU 메모리와 RAM 사용량 확인
 */
export class SystemResources {

  /** 사용 가능한 GPU 메모리 (MB 단위) */
  static async getAvailableGPUMemory(): Promise<number> {
    try {
      const { execSync } = await import('child_process');
      const output = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits').toString().trim();
      const memories = output.split('\n').map(Number).filter(m => !isNaN(m) && m > 0);
      return memories.length > 0 ? Math.min(...memories) : 0;
    } catch {
      return 0;
    }
  }

  /** 사용 가능한 시스템 RAM (GB 단위) */
  static async getAvailableRAM(): Promise<number> {
    try {
      const { execSync } = await import('child_process');
      const output = execSync('cat /proc/meminfo | grep MemAvailable').toString().trim();
      const value = parseInt(output.match(/MemAvailable:\s+(\d+)/)?.[1] || '0');
      return value / (1024 * 1024); // MB to GB
    } catch {
      return 4; // 기본값: 4GB 가정
    }
  }

  /**로컬 TTS 사용 가능 여부 판단 */
  static async canUseLocalTTS(): Promise<{ 
    canUse: boolean; 
    reason?: string; 
    gpuMemory: number; 
    ram: number 
  }> {
    const gpuMemory = await this.getAvailableGPUMemory();
    const ram = await this.getAvailableRAM();
    
    // 기준: GPU 2GB 이상 AND RAM 4GB 이상
    if (gpuMemory < 2048) {
      return { 
        canUse: false, 
        reason: `GPU 메모리 부족: ${gpuMemory}MB (필요: 2048MB)`,
        gpuMemory, 
        ram 
      };
    }
    
    if (ram < 4) {
      return { 
        canUse: false, 
        reason: `시스템 RAM 부족: ${ram.toFixed(1)}GB (필요: 4GB)`,
        gpuMemory, 
        ram 
      };
    }
    
    return { 
      canUse: true, 
      reason: `리소스 충분: GPU ${(gpuMemory/1024).toFixed(1)}GB, RAM ${ram.toFixed(1)}GB`,
      gpuMemory, 
      ram 
    };
  }
}