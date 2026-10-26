/**
 * ChatterBox TTS API client
 * Docker-based CPU-only TTS API
 */
export interface TTsApiOptions {
  language?: string;
  speed?: number;
  pitch?: number;
  emotion?: string;
  voice?: string;
}

export interface TTSApiResult {
  success: boolean;
  audioUrl: string; // base64 인코딩된 오디오 데이터 또는 파일 URL
  duration: number;
}

export class ChatterBoxAPI {
  private baseUrl: string;
  private apiKey: string;
  private defaultVoice: string = "default";

  constructor({
    baseUrl = "http://localhost:4123",
    apiKey = "",
    defaultVoice = "default"
  }: {
    baseUrl?: string;
    apiKey?: string;
    defaultVoice?: string;
  }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.defaultVoice = defaultVoice;
  }

  /**
   * 텍스트를 음성으로 변환
   */
  async textToSpeech(text: string, options?: TTsApiOptions): Promise<TTSApiResult> {
    try {
      const url = `${this.baseUrl}/v1/audio/speech`;
      
      const payload: any = {
        model: "tts-1",
        voice: options?.voice || this.defaultVoice,
        input: text,
      };

      // 언어가 Korean이면 언어 코드 변환
      if (options?.language === "ko") {
        payload.language = "ko";
      }

      // 감정 표현이 있으면 텍스트에 추가
      if (options?.emotion) {
        payload.input = `${text} ${options.emotion}`;
      }

      // 속도 조절
      if (options?.speed) {
        payload.speed = options.speed;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { "Authorization": `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      return {
        success: true,
        audioUrl: data.audio,
        duration: data.duration || 0,
      };
    } catch (error) {
      console.error("ChatterBox API error:", error);
      return {
        success: false,
        audioUrl: "",
        duration: 0,
      };
    }
  }

  /**
   * 사용 가능한 목소리 목록 조회
   */
  async listVoices(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/voices`, {
        headers: {
          ...(this.apiKey && { "Authorization": `Bearer ${this.apiKey}` }),
        },
      });
      
      if (!response.ok) return [];
      const data = await response.json();
      return data.voices || [];
    } catch {
      return [];
    }
  }

  /**
   * 목소리 클론 등록
   */
  async cloneVoice(audioFilePath: string, voiceName: string): Promise<boolean> {
    try {
      const formData = new FormData();
      formData.append("voice", audioFilePath);
      formData.append("name", voiceName);
      
      const response = await fetch(`${this.baseUrl}/v1/voices`, {
        method: "POST",
        body: formData,
        ...(this.apiKey && { "Authorization": `Bearer ${this.apiKey}` }),
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }
}