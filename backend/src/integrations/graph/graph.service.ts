import { Injectable } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { AuthService } from '../../auth/auth.service';

export interface GraphMessageReaction {
  reactionType?: string;
  displayName?: string;
  user?: {
    user?: {
      id?: string;
      displayName?: string;
      email?: string;
    };
  };
}

export interface GraphChatMessage {
  id: string;
  body?: { content?: string };
  from?: { user?: { id?: string; displayName?: string; email?: string } };
  createdDateTime?: string;
  replyToId?: string;
  reactions?: GraphMessageReaction[];
}

export interface GraphChatInfo {
  id: string;
  topic?: string;
  chatType?: string;
}

@Injectable()
export class GraphService {
  private readonly baseUrl = 'https://graph.microsoft.com/v1.0';

  constructor(private readonly authService: AuthService) {}

  private async request<T>(userId: string, config: AxiosRequestConfig): Promise<T> {
    try {
      const accessToken = await this.authService.getValidAccessToken(userId);
      const response = await axios.request<T>({
        ...config,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(config.headers ?? {}),
        },
      });
      return response.data;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status !== 401) {
        throw error;
      }
      const refreshedToken = await this.authService.getValidAccessToken(userId, true);
      const response = await axios.request<T>({
        ...config,
        headers: {
          Authorization: `Bearer ${refreshedToken}`,
          'Content-Type': 'application/json',
          ...(config.headers ?? {}),
        },
      });
      return response.data;
    }
  }

  async getCurrentUser(userId: string): Promise<{
    id: string;
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  }> {
    return this.request(userId, {
      method: 'GET',
      url: `${this.baseUrl}/me?$select=id,mail,userPrincipalName,displayName`,
    });
  }

  async listChats(userId: string, limit = 50): Promise<GraphChatInfo[]> {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const data = await this.request<{ value: GraphChatInfo[] }>(userId, {
      method: 'GET',
      url: `${this.baseUrl}/me/chats?$top=${safeLimit}&$select=id,topic,chatType`,
    });
    return data.value;
  }

  async getChat(userId: string, chatId: string): Promise<GraphChatInfo | null> {
    try {
      return await this.request<GraphChatInfo>(userId, {
        method: 'GET',
        url: `${this.baseUrl}/chats/${chatId}?$select=id,topic,chatType`,
      });
    } catch {
      return null;
    }
  }

  async listChatMembers(userId: string, chatId: string): Promise<Array<{ id?: string; displayName?: string; email?: string }>> {
    const members = await this.request<{
      value: Array<{ userId?: string; displayName?: string; email?: string }>;
    }>(userId, {
      method: 'GET',
      url: `${this.baseUrl}/chats/${chatId}/members`,
    });
    return members.value.map((member) => ({
      id: member.userId,
      displayName: member.displayName,
      email: member.email,
    }));
  }

  async listRecentMessages(
    userId: string,
    chatId: string,
    limit = 20,
  ): Promise<GraphChatMessage[]> {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const data = await this.request<{
      value: GraphChatMessage[];
    }>(userId, {
      method: 'GET',
      url: `${this.baseUrl}/chats/${chatId}/messages?$top=${safeLimit}&$orderby=createdDateTime desc`,
    });
    return data.value.reverse();
  }

  async getMessage(userId: string, chatId: string, messageId: string): Promise<GraphChatMessage | null> {
    try {
      return await this.request<GraphChatMessage>(userId, {
        method: 'GET',
        url: `${this.baseUrl}/chats/${chatId}/messages/${messageId}`,
      });
    } catch {
      return null;
    }
  }

  async sendReply(userId: string, chatId: string, messageId: string, htmlContent: string): Promise<void> {
    try {
      await this.request(userId, {
        method: 'POST',
        url: `${this.baseUrl}/chats/${chatId}/messages/replyWithQuote`,
        data: {
          messageIds: [messageId],
          replyMessage: {
            body: {
              contentType: 'html',
              content: htmlContent,
            },
          },
        },
      });
      return;
    } catch {
      // Fall through to compatibility paths.
    }

    try {
      await this.request(userId, {
        method: 'POST',
        url: `${this.baseUrl}/chats/${chatId}/messages/${messageId}/replies`,
        data: {
          body: {
            contentType: 'html',
            content: htmlContent,
          },
        },
      });
      return;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status !== 400 && status !== 404 && status !== 405) {
        throw error;
      }
    }

    await this.request(userId, {
      method: 'POST',
      url: `${this.baseUrl}/chats/${chatId}/messages`,
      data: {
        body: {
          contentType: 'html',
          content: htmlContent,
        },
        replyToId: messageId,
      },
    });
  }

}
