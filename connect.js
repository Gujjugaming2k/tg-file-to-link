import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import dotenv from "dotenv";

dotenv.config();

const session = process.env.APP_SESSION;

const apiId = parseInt(process.env.APP_API_ID);
const apiHash = process.env.APP_API_HASH;
const stringSession = new StringSession(session);
const token = process.env.token;

export default async function connect() {
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5
    });

    if (session) {
        console.log("connecting");
        await client.connect();
        console.log("Connected")
    } else {
        await client.start({
            botAuthToken: token
        });

        console.log(client.session.save());
    }

    return client;
}