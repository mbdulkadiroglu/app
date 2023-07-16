import dotenv from "dotenv";
import {App} from "octokit";
import {createNodeMiddleware} from "@octokit/webhooks";
import fs from "fs";
import http from "http";
import { Configuration, OpenAIApi } from "openai";
import axios from "axios";

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

// This defines the message that your app will post to pull requests.
const messageForNewPRs = "Review the diff and point out any issues: ";

// This adds an event handler that your code will call later. When this event handler is called, it will log the event to the console. Then, it will use GitHub's REST API to add a comment to the pull request that triggered the event.
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
            temperature: 1,
            max_tokens: 256,
            top_p: 1,
            presence_penalty: 0.0,
            frequency_penalty: 0.0,
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

// This sets up a webhook event listener. When your app receives a webhook event from GitHub with a `X-GitHub-Event` header value of `pull_request` and an `action` payload value of `opened`, it calls the `handlePullRequestOpened` event handler that is defined above.
app.webhooks.on("pull_request.opened", handlePullRequestOpened);

// This logs any errors that occur.
app.webhooks.onError((error) => {
    if (error.name === "AggregateError") {
        console.error(`Error processing request: ${error.event}`);
    } else {
        console.error(error);
    }
});

// This determines where your server will listen.
//
// For local development, your server will listen to port 3000 on `localhost`. When you deploy your app, you will change these values. For more information, see "[Deploy your app](#deploy-your-app)."
const port = 3000;
const host = 'localhost';
const path = "/api/webhook";
const localWebhookUrl = `http://${host}:${port}${path}`;

// This sets up a middleware function to handle incoming webhook events.
//
// Octokit's `createNodeMiddleware` function takes care of generating this middleware function for you. The resulting middleware function will:
//
//    - Check the signature of the incoming webhook event to make sure that it matches your webhook secret. This verifies that the incoming webhook event is a valid GitHub event.
//    - Parse the webhook event payload and identify the type of event.
//    - Trigger the corresponding webhook event handler.
const middleware = createNodeMiddleware(app.webhooks, {path});

// This creates a Node.js server that listens for incoming HTTP requests (including webhook payloads from GitHub) on the specified port. When the server receives a request, it executes the `middleware` function that you defined earlier. Once the server is running, it logs messages to the console to indicate that it is listening.
http.createServer(middleware).listen(port, () => {
    console.log(`Server is listening for events at: ${localWebhookUrl}`);
    console.log('Press Ctrl + C to quit.')
});