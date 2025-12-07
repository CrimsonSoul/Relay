import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class AvatarManager {
  private avatarDir: string;

  constructor(dataRoot: string) {
    this.avatarDir = path.join(dataRoot, 'avatars');
    if (!fs.existsSync(this.avatarDir)) {
      fs.mkdirSync(this.avatarDir, { recursive: true });
    }
  }

  private getHash(email: string): string {
    return crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex');
  }

  public getAvatarPath(email: string): string {
    const hash = this.getHash(email);
    return path.join(this.avatarDir, `${hash}.jpg`);
  }

  public async saveAvatar(email: string, buffer: Buffer): Promise<string> {
    const filePath = this.getAvatarPath(email);
    await fs.promises.writeFile(filePath, buffer);
    return filePath;
  }

  public hasAvatar(email: string): boolean {
    return fs.existsSync(this.getAvatarPath(email));
  }
}
