/**
 * TTS CLI commands
 * Dadabot CLI를 통한 TTS 제어
 */
import { IntelligentTTSManager } from '../integrations/intelligent-tts-manager';

export class TTSCmd {
  private tts: IntelligentTTSManager;

  constructor() {
    const apiBaseUrl = process.env.DADABOT_TTS_API_URL || 'http://localhost:4123';
    const apiKey = process.env.DADABOT_TTS_API_KEY || '';
    
    this.tts = new IntelligentTTSManager(apiBaseUrl, apiKey);
  }

  async setup(): Promise<void> {
    console.log('🔧 TTS 시스템 초기화 중...');
    await this.tts.initialize();
    console.log('✅ TTS 시스템 준비 완료');
  }

  async speak(text: string, options?: {
    language?: string;
    speed?: number;
    emotion?: string;
    forceLocal?: boolean;
    forceAPI?: boolean;
  }): Promise<void> {
    console.log(`🔊 음성 변환 요청: "${text}"`);
    
    const result = await this.tts.speak(text, {
      language: options?.language || 'ko',
      speed: options?.speed,
      emotion: options?.emotion,
      forceAPI: options?.forceAPI,
    });

    if (result.success) {
      console.log(`✅ 성공 (${result.method} 방식): ${result.duration.toFixed(1)}초`);
      console.log(`   오디오: ${result.audioUrl}`);
      await this.playAudio(result.audioUrl);
    } else {
      console.error(`❌ 실패: ${result.error}`);
      
      if (result.method === 'local' && !options?.forceAPI) {
        console.log('🔄 API로 재시도...');
        const apiResult = await this.tts.speak(text, {
          language: options?.language,
          forceAPI: true,
        });
        if (apiResult.success) {
          console.log(`🔄 API 재시도 성공: ${apiResult.duration.toFixed(1)}초`);
          await this.playAudio(apiResult.audioUrl);
        }
      }
    }
  }

  private async playAudio(audioUrl: string): Promise<void> {
    console.log(`🔊 재생: ${audioUrl}`);
    return new Promise(resolve => setTimeout(resolve, 1000));
  }
}