import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { message } from "telegraf/filters";
import connect from "./connect.js";
import crypto from "crypto";
import fs, { promises as fsPromises } from "fs";
import path from "path";
import { DownloaderHelper } from "node-downloader-helper";
import WebTorrent from 'webtorrent';
import express from "express";

dotenv.config()

const app = express();
const bot = new Telegraf(process.env?.token, {
    handlerTimeout: 600000
});

app.use(await bot.createWebhook({ domain: process.env.webhookDomain }));
app.use(express.static("./downloads"));

app.get("/", (req, res) => {
    res.send("Bot started");
});

function isUpdate(d1, d2) {
    let diff = Math.abs(d2.getTime() - d1.getTime()); // get the absolute difference in milliseconds

    return diff >= 5000;
}

function convertToValidUrl(inputUrl) {
    try {
        const decodedUrl = decodeURIComponent(inputUrl);

        const cleanedUrl = decodedUrl
            .replace(/\[/g, '%5B')
            .replace(/\]/g, '%5D')
            .replace(/\s/g, '%20')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29');

        return cleanedUrl;
    } catch (err) {
        console.error('Error converting URL:', err);
        return inputUrl; // Return null if an error occurs
    }
}

bot.start(ctx => {
    ctx.reply(`Hello ${ctx.message.from.first_name} !!`);
});

bot.on(message("video"), async (ctx) => {
    const a = await ctx.react("👍", true);

    if (!fs.existsSync("./downloads")) {
        await fsPromises.mkdir("./downloads");
    }

    const client = await connect();

    const id = ctx.message.message_id
    const vid = await client.getMessages(ctx.chat.id, { ids: id });

    let referenceDate = new Date()

    const msg = await ctx.reply("Downloading...", {
        reply_parameters: {
            message_id: id
        }
    });

    let dlMsgTxt = "Downloading...";

    const extension = path.extname(vid[0].document.attributes[1].fileName);
    const filename = crypto.randomBytes(4).toString("hex") + extension;

    try {
        await client.downloadMedia(vid[0], {
            progressCallback: async (downloaded, total) => {
                if (isUpdate(referenceDate, new Date())) {
                    const newDlMsgTxt = `Downloading...\n\nProgression ${(downloaded / total * 100).toPrecision(2)} %\nDownloaded: ${(downloaded / (1024 * 1024)).toPrecision(2)}MB\nTotal: ${(total / (1024 * 1024)).toPrecision(2)}MB`;

                    if (dlMsgTxt === newDlMsgTxt) {
                        referenceDate = new Date()

                        return;
                    };

                    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, newDlMsgTxt);
                    dlMsgTxt = newDlMsgTxt;
                }
            },
            outputFile: `./downloads/${filename}`,
        });

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Video is available at ${process.env.host}/${filename}`);
    } catch (e) {
        console.log(e)
        ctx.reply("Something went wrong. Retry later")
    }
});

bot.command("link", async (ctx) => {
    const URL = ctx.message.text.slice(6).trim();

    if (!fs.existsSync("./downloads")) {
        await fsPromises.mkdir("./downloads");
    }

    // if (!URL.startsWith("https") || !URL.startsWith("http")) {
    //     ctx.reply("Please enter a valid url", {
    //         reply_parameters: {
    //             message_id: ctx.message.message_id
    //         }
    //     });

    //     return;
    // }

    let interval = null
    let filename = "";

    const dl = new DownloaderHelper(URL, "./downloads", {
        fileName(fileName) {
            const extension = path.extname(fileName);
            filename = crypto.randomBytes(4).toString("hex") + extension;

            return filename;
        },
    })

    dl.on("end", async () => {
        clearInterval(interval);

        await ctx.deleteMessage(msg.message_id);
        await ctx.reply(`Video is available at ${process.env.host}/${filename}`, {
            reply_parameters: {
                message_id: ctx.message.message_id
            }
        });
    });

    dl.on("error", async (err) => await ctx.reply("Something went wrong: " + err))

    dl.start().catch(err => console.log(err))

    const msg = await ctx.reply("Downloading...", {
        reply_parameters: {
            message_id: ctx.message.message_id
        }
    });

    let dlMsgTxt = "Downloading...";

    interval = setInterval(async () => {
        const stats = dl.getStats()

        const progress = Math.floor(stats.progress);
        const fileName = stats.name;

        const newDlMsgTxt = `Downloading ${fileName}\n\nProgress: ${progress}`;

        if (dlMsgTxt === newDlMsgTxt) return;

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, newDlMsgTxt);

        dlMsgTxt = newDlMsgTxt;
    }, 5000)


})

bot.command("torrent", async (ctx) => {
    let magnetURI = ctx.message.text.slice(9).trim();

    if (ctx.message?.reply_to_message?.text) {
        magnetURI = ctx.message.reply_to_message.text;
    }

    if (ctx.message?.reply_to_message?.document && path.extname(ctx.message.reply_to_message.document.file_name) === ".torrent") {
        const fileLink = await ctx.telegram.getFileLink(ctx.message.reply_to_message.document.file_id);

        try {
            const response = await fetch(fileLink);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            await fsPromises.writeFile(`./downloads/${ctx.message.reply_to_message.document.file_name}`, buffer);

            magnetURI = `./downloads/${ctx.message.reply_to_message.document.file_name}`;
        } catch (error) {
            console.error('Error downloading file:', error.message);
        }
    }

    if (!magnetURI) return;


    if (!fs.existsSync("./downloads")) {
        await fsPromises.mkdir("./downloads");
    }

    const msg = await ctx.reply("Getting everythings ready...", {
        reply_parameters: {
            message_id: ctx.message.message_id
        }
    });

    const client = new WebTorrent();

    client.add(magnetURI, {
        path: "./downloads"
    }, async (torrent) => {
        let dlMsgTxt = `Downloading...\n\nTorrent Name: ${torrent.name}\nTorrent Size: ${Math.floor(torrent.length / (1024 * 1024))}mb`
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, dlMsgTxt);

        let referenceDate = new Date();

        torrent.on('download', async (bytes) => {

            if (isUpdate(referenceDate, new Date())) {
                const newDlMsgTxt = `Downloading...\n\nTorrent Name: ${torrent.name}\nTorrent Size: ${Math.floor(torrent.length / (1024 * 1024))}mb\n\nProgression ${(torrent.progress * 100).toPrecision(2)}%\nDownloaded: ${(torrent.downloaded / (1024 * 1024)).toPrecision(2)}mb\nSpeed: ${(torrent.downloadSpeed / (1024 * 1024)).toPrecision(2)}mb/s`;

                if (dlMsgTxt.trim() === newDlMsgTxt.trim()) {
                    referenceDate = new Date()

                    return;
                };

                dlMsgTxt = newDlMsgTxt;

                try {
                    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, newDlMsgTxt);
                } catch (error) {
                    console.log(error)
                }
            }
        })

        torrent.on('done', async () => {
            if (torrent.files.length > 1) {
                for (const file of torrent.files) {
                    let link = `${process.env.host}/${torrent.name}/${file.name}`;
                    await ctx.reply(`Name: ${file.name}\nSize:${Math.floor(file.length / (1024 * 1024))}mb\n\nLink: ${convertToValidUrl(link)}`, {
                        reply_parameters: {
                            message_id: ctx.message.message_id
                        }
                    })
                }
            } else {
                let link = `${process.env.host}/${file.name}`;
                await ctx.reply(`Name: ${file.name}\nSize:${Math.floor(file.length / (1024 * 1024))}mb\n\nLink: ${convertToValidUrl(link)}`, {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
            }

            await ctx.reply("Torrent downloaded completed !!");

            client.destroy();
        })

    })

    client.on("error", (err) => {
        ctx.reply("An unexpected error occured");
    })
});

bot.command('seed', () => {
    const client = new WebTorrent();

    client.seed("./downloads/56df6bb4.mp4", async (torrent) => {
        console.log(torrent.magnetURI)
    })

})

app.listen(3000, () => {
    console.log("Ready")
})