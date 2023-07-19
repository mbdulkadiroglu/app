import { Configuration, OpenAIApi } from "openai";
import axios from "axios";
import dotenv from "dotenv";
import {App} from "octokit";
import {createNodeMiddleware} from "@octokit/webhooks";
import fs from "fs";
import http from "http";

dotenv.config();

const appId = process.env.APP_ID;
const webhookSecret = process.env.WEBHOOK_SECRET;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;
const apiKey = process.env.OPENAI_API_KEY;

const configuration = new Configuration({
    apiKey: apiKey
});
const openai = new OpenAIApi(configuration);

const privateKey = fs.readFileSync(privateKeyPath, "utf8");

const app = new App({
    appId: appId,
    privateKey: privateKey,
    webhooks: {
        secret: webhookSecret
    },
});

async function handlePullRequestOpened({octokit, payload}) {
    console.log(`Received a pull request event for #${payload.pull_request.number}`);


    try {
        const diff_url = payload.pull_request.diff_url;
        const diff = await axios.get(diff_url);
        const diffText = await diff.data;

        const gptResponse = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages:[
                {
                    "role" : "system",
                    "content" : "You will be reviewing a diff of a pull request. Please review it and point out any issues in a concise way."
                },
                {
                    "role" : "user",
                    "content" : diffText
                }
            ],
            temperature: 0.3,
            max_tokens: 256,
            top_p: 0.3,
            presence_penalty: 0.7,
            frequency_penalty: 0.5,
        })

        await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            issue_number: payload.pull_request.number,
            body: gptResponse.data.choices[0].message.content,
            headers: {
                "x-github-api-version": "2022-11-28",
            },
        });
    } catch (error) {
        if (error.response) {
            console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`)
        }
        console.error(error)
    }
}

app.webhooks.on("pull_request.opened", handlePullRequestOpened);

app.webhooks.onError((error) => {
    if (error.name === "AggregateError") {
        console.error(`Error processing request: ${error.event}`);
    } else {
        console.error(error);
    }
});

const port = 3000;
const host = 'localhost';
const path = "/api/webhook";
const localWebhookUrl = `http://${host}:${port}${path}`;

const middleware = createNodeMiddleware(app.webhooks, {path});



http.createServer(middleware).listen(port, () => {
    console.log(`Server is listening for events at: ${localWebhookUrl}`);
    console.log('Press Ctrl + C to quit.')
});

