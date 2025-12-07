import axios from 'axios';

export class GraphService {
  private getAccessToken: () => Promise<string | null>;

  constructor(tokenProvider: () => Promise<string | null>) {
    this.getAccessToken = tokenProvider;
  }

  private async getClient() {
    const token = await this.getAccessToken();
    if (!token) throw new Error('Not authenticated');

    return axios.create({
      baseURL: 'https://graph.microsoft.com/v1.0',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  public async getUserProfile() {
    const client = await this.getClient();
    const res = await client.get('/me');
    return res.data;
  }

  public async getBatchUsers(emails: string[]) {
    // Graph doesn't have a simple "get by emails" batch endpoint that is efficient for large lists
    // without using $filter or batch requests.
    // Limit: 15 items per batch request step, or complex $filter.
    // For simplicity, we will try to look up users one by one or in small groups?
    // Actually, we can use `/users?$filter=mail in ('...','...')`
    // But URL length limits apply.
    // Let's implement a loop.

    const client = await this.getClient();
    const results: any[] = [];

    // Chunking
    const chunkSize = 15;
    for (let i = 0; i < emails.length; i += chunkSize) {
      const chunk = emails.slice(i, i + chunkSize);
      const filter = chunk.map(e => `mail eq '${e}'`).join(' or ');
      try {
        const res = await client.get(`/users`, {
          params: {
            '$filter': filter,
            '$select': 'displayName,jobTitle,mail,id,mobilePhone,businessPhones'
          }
        });
        if (res.data.value) {
          results.push(...res.data.value);
        }
      } catch (err) {
        console.error(`Failed to fetch chunk ${i}`, err);
      }
    }
    return results;
  }

  public async getPhoto(userId: string): Promise<Buffer | null> {
    try {
      const client = await this.getClient();
      const response = await client.get(`/users/${userId}/photo/$value`, {
        responseType: 'arraybuffer'
      });
      return Buffer.from(response.data);
    } catch (error) {
      // 404 is common if no photo
      return null;
    }
  }
}
