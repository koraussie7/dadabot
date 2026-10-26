/**
 * Intelligent TTS Manager with auto fallback
 * 시스템 리소스에 따라 로컬 또는 API TTS 자동 선택
 */
import { SystemResources } from './tts-resources';
import { ChatterBoxAPI } from './chatter-box-tts';
import { ChatterBoxLocal } from './chatter-box-local';

export type TTSMethod = 'local' | 'api' | 'fallback';
export type TTSResult = {
  success: boolean;
  audioUrl: string;
  duration: number;
  method: TTSMethod;
  text: string;
  error?: string;
};

/**
 * 로컬 + API 자동 폴백이 가능한 지능형 TTS 매니저
 * 시스템 리소스에 따라 최적의 방법 자동 선택
 */
export class IntelligentTTSManager {

  private api: ChatterBoxAPI;
  private local: ChatterBoxLocal | null = null;
  private resources: ReturnType<typeof SystemResources['canUseLocalTTS']>;
  private config = {
    preferLocal: true,
    fallbackToAPI: true,
    minLocalGpuMemory: 2048,
    minLocalRam: 4096,
    cacheResults: true,
    cacheTtl: 3600000
  };

  constructor(apiBaseUrl: string = "http://localhost:4123", apiKey: string = "") {
    this.api = new ChatterBoxAPI(apiBaseUrl, apiKey);
    this.resources = { canUse: false, reason: 'System check not run', gpuMemory: 0, ram: 0 };
  }

  async initialize(): Promise<void> {
    this.resources = await SystemResources.canUseLocalTTS();
    
    if (this.resources.canUse && this.config.preferLocal) {
      try {
        this.local = new ChatterBoxLocal();
        await this.local.initialize();
        console.log(`✅ 로컬 TTS 사용 가능: ${this.resources.reason}`);
      } catch (error) {
        console.warn(`⚠️ 로컬 TTS 초기화 실패, API로 폴백: ${error.message}`);
        this.local = null;
        this.resources = { canUse: false, reason: 'Local initialization failed', gpuMemory: 0, ram: 0 };
      }
    } else {
      console.log(`🌐 로컬 TTS 사용 불가, API 모드 사용: ${this.resources.reason}`);
      this.local = null;
    }
  }

  async speak(text: string, options?: {
    language?: string;
    speed?: number;
    emotion?: string;
    voice?: string;
    forceAPI?: boolean;
  }): Promise<TTSResult> {

    if (options?.forceAPI || !this.config.fallbackToAPI) {
      return this.useAPI(text, options);
    }

    if (this.local && this.resources.canUse) {
      try {
        const localResult = await this.useLocal(text, options);
        if (localResult.success) {
          if (this.config.cacheResults) {
            this.cacheResult(text, localResult, 'local');
          }
          console.log(`🎤 로컬 TTS 생성 성공: ${localResult.duration.toFixed(1)}초`);
          return { ...localResult, method: 'local', text };
        } else {
          console.warn(`⚠️ 로컬 TTS 실패, API로 폴백: ${localResult.error}`);
        }
      } catch (error) {
        console.warn(`⚠️ 로컬 TTS 예외, API로 폴백: ${error.message}`);
      }
    } else if (!this.resources.canUse && this.local) {
      console.log(`🔄 로컬 리소스 부족 감지, API로 전환`);
      this.local = null;
    }

    return this.useAPI(text, options);
  }

  private async useLocal(text: string, options?: {
    language?: string;
    speed?: number;
    emotion?: string;
    voice?: string;
  }): Promise<{ success: boolean; audioUrl: string; duration: number; error?: string }> {
    if (!this.local) throw new Error('Local TTS not initialized');
    
    let processedText = text;
    if (options?.emotion) {
      processedText += ` ${options.emotion}`;
    }

    try {
      const result = await this.local.textToSpeech(processedText, {
        model: 'turbo',
        language: options?.language || 'en',
        keepModelLoaded: true,
      });
      
      return {
        success: true,
        audioUrl: result.audioFile,
        duration: result.duration,
      };
    } catch (error) {
      console.error('Local TTS error:', error);
      return {
        success: false,
        audioUrl: '',
        duration: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async useAPI(text: string, options?: {
    language?: string;
    speed?: number;
    emotion?: string;
    voice?: string;
  }): Promise<{ success: boolean; audioUrl: string; duration: number; error?: string }> {
    try {
      const result = await this.api.textToSpeech(text, {
        language: options?.language || 'ko',
        speed: options?.speed || 1.0,
        emotion: options?.emotion,
        voice: options?.voice,
      });

      if (result.success) {
        if (this.config.cacheResults) {
          this.cacheResult(text, { ...result, method: 'api' }, 'api');
        }
        return {
          success: true,
          audioUrl: result.audioUrl,
          duration: result.duration,
        };
      } else {
        throw new Error(result.error || 'API request failed');
      }
    } catch (error) {
      console.error('API TTS error:', error);
      return {
        success: false,
        audioUrl: '',
        duration: 0,
        error: error instanceof Error ? error.message : 'Unknown API error',
      };
    }
  }

  private cacheResult(text: string, result: any, method: string): void {
    console.debug(`💾 TTS 결과 캐시됨: ${method} - ${Buffer.from(text).toString('base64').substring(0, 16)}...`);
  }
}