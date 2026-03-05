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

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    const accessToken = await this.authService.getValidAccessToken();
    const response = await axios.request<T>({
      ...config,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(config.headers ?? {}),
      },
    });
    return response.data;
  }

  async getCurrentUser(): Promise<{
    id: string;
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  }> {
    return this.request({
      method: 'GET',
      url: `${this.baseUrl}/me?$select=id,mail,userPrincipalName,displayName`,
    });
  }

  async listChats(limit = 50): Promise<GraphChatInfo[]> {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const data = await this.request<{ value: GraphChatInfo[] }>({
      method: 'GET',
      url: `${this.baseUrl}/me/chats?$top=${safeLimit}&$select=id,topic,chatType`,
    });
    return data.value;
  }

  async getChat(chatId: string): Promise<GraphChatInfo | null> {
    try {
      return await this.request<GraphChatInfo>({
        method: 'GET',
        url: `${this.baseUrl}/chats/${chatId}?$select=id,topic,chatType`,
      });
    } catch {
      return null;
    }
  }

  async listChatMembers(chatId: string): Promise<Array<{ id?: string; displayName?: string; email?: string }>> {
    const members = await this.request<{
      value: Array<{ userId?: string; displayName?: string; email?: string }>;
    }>({
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
    chatId: string,
    limit = 20,
  ): Promise<GraphChatMessage[]> {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const data = await this.request<{
      value: GraphChatMessage[];
    }>({
      method: 'GET',
      url: `${this.baseUrl}/chats/${chatId}/messages?$top=${safeLimit}&$orderby=createdDateTime desc`,
    });
    return data.value.reverse();
  }

  async getMessage(chatId: string, messageId: string): Promise<GraphChatMessage | null> {
    try {
      return await this.request<GraphChatMessage>({
        method: 'GET',
        url: `${this.baseUrl}/chats/${chatId}/messages/${messageId}`,
      });
    } catch {
      return null;
    }
  }

}
