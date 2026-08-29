declare module "@signalwire/compatibility-api" {
  export interface MessageInstance {
    sid: string;
    status: string;
    errorCode?: number;
    errorMessage?: string;
    to: string;
    from: string;
  }

  export interface MessageCreateOptions {
    from: string;
    to: string;
    body?: string;
  }

  export interface CompatibilityApi {
    messages: {
      create(options: MessageCreateOptions): Promise<MessageInstance>;
    };
  }

  export interface RestClientOptions {
    signalwireSpaceUrl?: string;
  }

  export function RestClient(
    projectId: string,
    apiToken: string,
    options?: RestClientOptions
  ): CompatibilityApi;
}
