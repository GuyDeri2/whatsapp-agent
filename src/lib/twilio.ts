import Twilio from "twilio";

class TwilioService {
  private client: Twilio.Twilio | null = null;

  private getClient(): Twilio.Twilio {
    if (!this.client) {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!accountSid || !authToken) {
        throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
      }
      this.client = Twilio(accountSid, authToken);
    }
    return this.client;
  }

  async sendSms(to: string, body: string): Promise<void> {
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    if (!fromNumber) {
      throw new Error("Missing TWILIO_FROM_NUMBER");
    }

    const client = this.getClient();
    await client.messages.create({ to, from: fromNumber, body });
  }
}

export const twilioService = new TwilioService();
