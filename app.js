const restify = require("restify");
const builder = require("botbuilder");
const serviceNow = require("./dialogs/serviceNow");
const botbuilder_azure = require("botbuilder-azure");
const teams = require("botbuilder-teams");
const builder_cognitiveservices = require("botbuilder-cognitiveservices");
const axios = require("axios");

// Uncomment for local development

/*
let dotenv = require("dotenv");
dotenv.load();
*/

// Setup Restify Server
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log("%s listening to %s", server.name, server.url);
});

// Create chat connector for communicating with the Bot Framework Service
const connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

/*----------------------------------------------------------------------------------------
 * Bot Storage: This is a great spot to register the private state storage for your bot. 
 * We provide adapters for Azure Table, CosmosDb, SQL Azure, or you can implement your own!
 * For samples and documentation, see: https://github.com/Microsoft/BotBuilder-Azure
 * ---------------------------------------------------------------------------------------- */

const tableName = 'EcobotData';
const azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env.StorageAccountConnectionString);
const tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);

console.log(azureTableClient);
console.log(tableStorage);

// Create your bot with a function to receive messages from the user

let bot = new builder.UniversalBot(connector);
bot.set('storage', tableStorage);

// For Local Development Use The below Code
/*
const bot = new builder.UniversalBot(connector, {
    storage: new builder.MemoryBotStorage()
});
*/

// Recognizer and and Dialog for GA QnAMaker service
const recognizer = new builder_cognitiveservices.QnAMakerRecognizer({
    knowledgeBaseId: process.env.QnAKnowledgebaseId,
    authKey: process.env.QnAAuthKey || process.env.QnASubscriptionKey, // Backward compatibility with QnAMaker (Preview)
    endpointHostName: process.env.QnAEndpointHostName
});

const basicQnAMakerDialog = new builder_cognitiveservices.QnAMakerDialog({
    recognizers: [recognizer],
    defaultMessage: 'No match! Try changing the query terms!',
    qnaThreshold: 0.3
});

const model =
    "https://eastus2.api.cognitive.microsoft.com/luis/v2.0/apps/" +
    process.env.LuisId +
    "?subscription-key=" +
    process.env.LuisKey +
    "&verbose=true&timezoneOffset=-8.0&q=";

const luisRecognizer = new builder.LuisRecognizer(model);

const intents = new builder.IntentDialog({
    recognizers: [luisRecognizer, recognizer],
    recognizeOrder: builder.RecognizeOrder.series
});

const stripBotAtMentions = new teams.StripBotAtMentions();

bot.use(stripBotAtMentions);

bot.dialog("/", intents);

intents.matches(
    "greeting", 
    builder.DialogAction.beginDialog("/greeting")
);

intents.matches(
    "getIncident",
    builder.DialogAction.beginDialog("/getIncident")
);

intents.matches(
    "createIncident",
    builder.DialogAction.beginDialog("/createIncident")
);

intents.matches(
    "updateIncident",
    builder.DialogAction.beginDialog("/updateIncident")
);

intents.matches(
    "resolveIncident",
    builder.DialogAction.beginDialog("/resolveIncident")
);

intents.matches(
    "reopenIncident",
    builder.DialogAction.beginDialog("/reopenIncident")
);

intents.matches(
    "searchKnowledgeBase",
    builder.DialogAction.beginDialog("/searchKnowledgeBase")
);

intents.matches(
    "serviceNowMenu",
    builder.DialogAction.beginDialog("/serviceNowMenu")
);

intents.matches(
    "ThankYou", 
    builder.DialogAction.beginDialog("/thankYou")
);

intents.matches(
    "qna", 
    builder.DialogAction.beginDialog("basicQnAMakerDialog")
);

intents.matches(
    "none",
    builder.DialogAction.beginDialog("/None")
);

intents.onDefault(
    [
        (session) => {
            let message = session.message.text
            session.send(
                "Oops! I didn't understand **'" + message  + "'** " +
                session.message.user.name + 
                "! Either I'm not sure how to respond, or I may not have the answer right now. You could always \
                try to rephrase your question and I'll try again to find you an answer!"
            );
        }
    ]
); 

// override
basicQnAMakerDialog.respondFromQnAMakerResult = (session, qnaMakerResult) => {
    // Save the question
    let question = session.message.text;
    session.conversationData.userQuestion = question;

    // boolean to check if the result is formatted for a card
    let isCardFormat = qnaMakerResult.answers[0].answer.includes(";");
    console.log(isCardFormat);
    if (!isCardFormat) {
        // Not semi colon delimited, send a normal text response 
        session.send(qnaMakerResult.answers[0].answer);
    } else if (qnaMakerResult.answers && qnaMakerResult.score >= 0.5) {
        let qnaAnswer = qnaMakerResult.answers[0].answer;

        let qnaAnswerData = qnaAnswer.split(";");
        let title = qnaAnswerData[0];
        let description = qnaAnswerData[1];
        let url = qnaAnswerData[2];
        let imageURL = qnaAnswerData[3];

        let msg = new builder.Message(session);
        console.log(msg);
        msg.attachments([
            new builder.HeroCard(session)
            .title(title)
            .subtitle(description)
            .images([builder.CardImage.create(session, imageURL)])
            .buttons([builder.CardAction.openUrl(session, url, "Learn More")])
        ]);
        session.send(msg).endDialog();
    }
    
};

basicQnAMakerDialog.defaultWaitNextMessage = (session, qnaMakerResult) => {
    // saves the user's question
    session.conversationData.userQuestion = session.message.text;

    if (!qnaMakerResult.answers) {
        let msg = new builder.Message(session).addAttachment({
                contentType: "application/vnd.microsoft.card.adaptive",
                content: {
                    type: "AdaptiveCard",
                    body: [{
                            type: "TextBlock",
                            text: "" + session.conversationData.userQuestion,
                            size: "large",
                            weight: "bolder",
                            color: "accent",
                            wrap: true
                        },
                        {
                            type: "TextBlock",
                            text: "Sorry, no answer found in QnA service",
                            size: "large",
                            weight: "regular",
                            color: "dark",
                            wrap: true
                        }
                    ]
                }
            });
        session.send(msg);
    }
    session.endDialog();
};

bot.dialog('basicQnAMakerDialog', basicQnAMakerDialog);


bot
    .dialog("/greeting", [
        (session) => {
            session.send(
                "Hi! I'm EcoBot! I'm a bot that can help you manage incidents in ServiceNow! Go ahead! Ask me a question! Try saying something like: 'What can you do?'"
            );
            session.replaceDialog("/");
        }
    ])
    .triggerAction({
        matches: "greeting"
    })
    .endConversationAction("endHello", "Ok. Goodbye.", {
            matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
            confirmPrompt: "Are you sure?"
        });

bot
    .dialog("/thankYou", [
        (session) => {
            session.send("Of course, " + session.message.user.name + "!");
            session.replaceDialog("/");
        }
    ])
    .triggerAction({
        matches: "ThankYou"
    });

bot
    .dialog("/specifyCredentials", [
        (session) => {
        builder.Prompts.text(
            session, 
            "What is the first name you use to log in to Service Now?"
        );
    },
    (session, results) => {
        session.dialogData.firstName = results.response;
        builder.Prompts.text(session, "Thanks! And your last name?");
    },
    (session, results) => {
        session.dialogData.lastName = results.response;
        serviceNow
            .getUserRecord(session.dialogData.firstName, session.dialogData.lastName)
            .then((res) => {
                session.userData.caller_id = res.data.result[0].sys_id;
                session.send("Thanks, " + session.dialogData.firstName + "!");
                session.endDialog();
            })
            .catch((err) => {
                session.send(
                    "Hmm, I can't find your user account with those credentials. Let's try again."
                );
                session.replaceDialog("/specifyCredentials");
            });
    }
]);

bot.dialog("/login", [
    (session) => {
        if (session.message.address.channelId === "msteams") {
            //There are 2 steps to get the user info from a chat
            //1. Get an access token
            //2. Use the access token to pull the user
            const appId = process.env.MicrosoftAppId;
            const appPassword = process.env.MicrosoftAppPassword;
            const tokenUrl = 
                "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token";
            let tokenBody = 
                "grant_type=client_credentials&client_id=" +
                appId +
                "&client_secret=" +
                appPassword +
                "&scope=https://api.botframework.com/.default";
            const tokenConfig = {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Host: "login.microsoftonline.com"
                }
            };
            //This request will return the access token
            axios.post(tokenUrl, tokenBody, tokenConfig).then((res) => {
                    let accessToken = res.data.access_token;
                    let root = session.message.address.serviceUrl;
                    let conversationID = session.message.address.conversation.id;
                    let route = root.concat(
                        "/v3/conversations/" + conversationID + "/members"
                    );
                    let authorizedConfig = {
                        headers: {
                            Authorization: "Bearer " + accessToken
                        }
                    };
                    //This request will return the user
                    axios
                        .get(route, authorizedConfig)
                        .then((res) => {
                            //RESULTANT PAYLOAD - 
                            // [{ id: '29:1GEnGoPgXQBlHio0KwoUwxhqLfMAvdLQXpFOn7PEIsBjrKBgnYmwJeepucBpCT6fSkCQF7LXW2IWqJgnT3lYiyw',
                            // objectId: 'c49fe892-7d11-4ef8-a551-a755a2471b4a',
                            // name: 'Lucas Huet-Hudson',
                            // givenName: 'Lucas',
                            // surname: 'Huet-Hudson',
                            // email: 'lucashh@microsoft.com',
                            // userPrincipalName: 'lucashh@microsoft.com' } ]
                            let firstName = res.data[0].givenName;
                            let lastName = res.data[0].surname;
                            serviceNow
                                .getUserRecord(firstName, lastName)
                                .then((res) => {
                                    session.userData.caller_id = res.data.result[0].sys_id;
                                    session.userData.user_name = res.data.result[0].user_name;
                                    session.endDialog();
                                })
                                .catch((err) => {
                                    session.send(
                                        "Hmm, I can't find your user account with your teams credentials."
                                    );
                                    session.replaceDialog("/specifyCredentials");
                                });
                        })
                        .catch((err) => {
                            session.send(
                                "Hmm, I can't find your user account with your teams credentials."
                            );
                            session.replaceDialog("/specifyCredentials");
                        });
                });
        } else {
            session.replaceDialog("/specifyCredentials");
        }
    }
]);

bot
    .dialog("/serviceNowMenu", [
        (session) => {
            let card = new builder.ThumbnailCard(session)
                .title("EcoBot")
                .text("Here's a few things I can do:")
                .buttons([
                builder.CardAction.imBack(
                    session, 
                    "Get Incidents", 
                    "View recently created ServiceNow Incidents"
                 ),
                builder.CardAction.imBack(
                    session, 
                    "Create a new ServiceNow Incident", 
                    "Create a new ServiceNow Incident"
                ),
                builder.CardAction.imBack(
                    session, 
                    "Update Incident", 
                    "Add comments to a ServiceNow Incident"
                ),
                builder.CardAction.imBack(
                    session, 
                    "Resolve Incident", 
                    "Resolve your ServiceNow Incident"
                ),
            ]);
            let message = new builder.Message(session).addAttachment(card);
            session.endConversation(message);
        }
    ])
    .triggerAction({
        matches: "serviceNowMenu"
    })
    .endConversationAction("endGreeting", "Ok. Goodbye.", {
        matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
        confirmPrompt: "Are you sure?"
    });

bot
    .dialog("/createIncident", [
        (session, results, next) => {
            if (!session.userData.caller_id) {
                session.beginDialog("/login");
            } else {
                next();
            }
        },
        (session) => {
            session.send(
                "I understand that you want to open a new incident in ServiceNow"
            );
            builder.Prompts.choice(
                session, 
                "Did I understand you correctly?", [
                    "Yes, please help me create an incident.", 
                    "No, I do not need to create an incident right now."
                ], { 
                listStyle: builder.ListStyle.button 
            }
        );
    },
    (session, results, next) => {
        if (
            results.response.entity === "Yes, please help me create an incident."
        ) {
            builder.Prompts.text(
                session, 
                "What's your short description of the problem?"
            );
            next();
        } else {
            session.send(
                "Sorry I misunderstood! Maybe I can help with something else?"
            );
            session.endDialog();
        }
    },
    (session, results) => {
        session.dialogData.short_description = results.response;
        session.send("Got it! I just need a little more information.");
        builder.Prompts.text(
            session, 
            "Please describe the problem in more detail"
        );
    },
    (session, results) => {
        session.dialogData.description = results.response;
        builder.Prompts.choice(
            session, 
            "Would you like to add any additional notes?", ["Yes", "No"], { listStyle: builder.ListStyle.button }
        );
    },
    (session, results, next) => {
        if (results.response.entity === "Yes") {
            builder.Prompts.text(
                session, 
                "What other notes should I add to the incident?"
            );
            next();
        } else {
            session.send(
                "Thanks! I was successfully able to submit your issue as an incident in ServiceNow!"
            );
            let url = 
                "https://ecolabstage.service-now.com/sp?id=all_tickets&table=incident&filter=opened_by%3Djavascript:gs.getUserID()%5EORcaller_id%3Djavascript:gs.getUserID()%5EORwatch_listLIKEjavascript:gs.getUserID()%5Eactive%3Dtrue&d=desc#home";
            let imageURL = 
                "https://eclcdwbotwabsa.blob.core.windows.net/images/Ecolab-IT-Help-Center.png";
            let msg = new builder.Message(session);
            msg.attachments([
                new builder.HeroCard(session)
                .images([builder.CardImage.create(session, imageURL)])
                .buttons([
                    builder.CardAction.openUrl(session, url, "View My Incidents")
                ])
            ]);
            session.send(msg);
            serviceNow
                .createIncident(session.dialogData, session.userData.caller_id)
                .then((res) => {
                    session.endDialog();
                })
                .catch((err) => {
                    console.log("ERR", err);
                });
        }
    },
    (session, results) => {
        session.dialogData.notes = results.response;
        session.send(
            "Thanks! I was successfully able to submit your issue as an incident in ServiceNow!"
        );
        let url = 
        "https://ecolabstage.service-now.com/sp?id=all_tickets&table=incident&filter=opened_by%3Djavascript:gs.getUserID()%5EORcaller_id%3Djavascript:gs.getUserID()%5EORwatch_listLIKEjavascript:gs.getUserID()%5Eactive%3Dtrue&d=desc#home";
        let imageURL = 
        "https://eclcdwbotwabsa.blob.core.windows.net/images/Ecolab-IT-Help-Center.png";
        let msg = new builder.Message(session);
        msg.attachments([
            new builder.HeroCard(session)
            .images([builder.CardImage.create(session, imageURL)])
            .buttons([
                builder.CardAction.openUrl(session, url, "View My Incidents")
            ])
        ]);
        session.send(msg);
        serviceNow
            .createIncident(session.dialogData, session.userData.caller_id)
            .then((res) => {
                session.endDialog();
            });
    }
])
.triggerAction({
    matches: "createIncident"
})
.endConversationAction("endIncidentCreate", "Ok. Goodbye.", {
        matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
        confirmPrompt: "Are you sure?"
    });

bot
    .dialog("/searchKnowledgeBase", [
        (session, results, next) => {
            if (!session.userData.caller_id) {
                session.beginDialog("/login");
            } else {
                next();
            }
        },
        (session) => {
            session.send(
                "I understand that you need help finding a knowledge article in ServiceNow."
            );
            builder.Prompts.choice(
                session, 
                "Did I understand you correctly?", ["Yes, please search IT Help Center.", "No, not now."], { listStyle: builder.ListStyle.button }
            );
        },
        (session, results, next) => {
            if (results.response.entity === "Yes, please search IT Help Center.") {
                builder.Prompts.text(
                    session, 
                    "What would you like to search for? I will be able to provide the first 10 results of what I find."
                );
                next();
            } else {
                session.send(
                    "Sorry I misunderstood! Maybe I can help with something else?"
                );
                session.endDialog();
            }
        },
        (session, results) => {
            session.dialogData.searchQuery = results.response;
            serviceNow
                .searchKnowledgeBase(session.dialogData.searchQuery)
                .then((res) => {
                    if (res.status == "200") {
                        console.log("Successfully queried KB");
                        console.log(res);
                        if (res.data.result.length > 0) {
                            session.dialogData.searchResults = res.data.result;
                            session.send("Here's what I found:");
                            let feed = session.dialogData.searchResults;
                            let msg = new builder.Message(session).attachmentLayout(
                                builder.AttachmentLayout.carousel
                            );
                            feed.forEach((result, i) => {
                                    let url = 
                                        "https://ecolabstage.service-now.com/sp?id=kb_article&sys_id=" +
                                        result.sys_id;
                                    msg.addAttachment(
                                        new builder.HeroCard(session)
                                        .title(result.short_description)
                                        .text(result.number)
                                        .buttons([
                                            builder.CardAction.openUrl(session, url, "Learn More")
                                        ])
                                    );
                                }),
                                session.send(msg);
                            session.replaceDialog("/getResultFeedback");
                        } else {
                            session.send(
                                "Unfortunately, I wasn't able to find anything referencing \"" +
                                session.dialogData.searchQuery +
                                '"'
                            );
                            session.replaceDialog("/getResultFailFeedback");
                        }
                    }
                }
            );
        }
    ]
)
    .triggerAction({
        matches: "searchKnowledgeBase"
    }
)
    .endConversationAction("endSearchKnowledgeBase", "Ok. Goodbye.", {
            matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
            confirmPrompt: "Are you sure?"
    }
);

bot
    .dialog("/getResultFeedback", [
        (session) => {
            builder.Prompts.choice(
                session, 
                "Did that help?", ["Yes, Thanks!", "I need to rephrase what I want to search."], { listStyle: builder.ListStyle.button }
            );
        },
        (session, results) => {
            if (results.response.entity === "Yes, Thanks!") {
                session.send(
                    "Awesome! Let me know if I can help you find anything else!"
                );
                session.endDialog();
            } else if (
                results.response.entity === "I need to rephrase what I want to search."
            ) {
                session.send("Ok!");
                session.replaceDialog("/searchKnowledgeBase");
            }
        }
    ])
    .triggerAction({
        matches: "getResultFeedback"
    })
    .endConversationAction(
        "endgetResultFeedback", "Ok. Goodbye.", {
            matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
            confirmPrompt: "Are you sure?"
        }
    );

bot
    .dialog("/getResultFailFeedback", [
        (session) => {
            builder.Prompts.choice(
                session, 
                "Would you like me search for something else?", ["Yes, I'll rephrase my search query.", "No, Thanks."], { listStyle: builder.ListStyle.button }
            );
        },
        (session, results) => {
            if (results.response.entity === "Yes, I'll rephrase my search query.") {
                session.send("Ok!");
                session.replaceDialog("/searchKnowledgeBase");
            } else {
                session.send(
                    "Bummer! Hopefully I'll have something useful in the near future."
                );
                session.endDialog();
            }
        }
    ])
    .triggerAction({
        matches: "getResultFailFeedback"
    })
    .endConversationAction(
        "endgetResultFailFeedback", "Ok. Goodbye.", {
            matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
            confirmPrompt: "Are you sure?"
        }
    );

bot
    .dialog("/updateIncident", [
        (session, results, next) => {
            if (!session.userData.caller_id) {
                session.beginDialog("/login");
            } else {
                next();
            }
        },
        (session) => {
            session.dialogData.user_name = session.userData.user_name;
            console.log(session.userData.user_name);
            session.send(
                "I understand that you need help updating an incident in ServiceNow."
            );
            builder.Prompts.choice(
                session, 
                "Did I understand you correctly?", ["Yes, update an incident for me.", "No, not now."], { listStyle: builder.ListStyle.button }
            );
        },
        (session, results, next) => {
            if (results.response.entity === "Yes, update an incident for me.") {
                next();
            } else {
                session.send(
                    "Sorry I misunderstood! Maybe I can help with something else?"
                );
                session.endDialog();
            }
        },
        (session, next) => {
            serviceNow.getIncidents(session.userData.caller_id).then((res) => {
                    console.log("Successfully queried Incidents");
                    console.log(res);
                    if (res.data.result.length > 0) {
                        session.dialogData.searchResults = res.data.result;
                        session.send(
                            "Here are your 5 most recently unresolved incidents in ServiceNow:"
                        );
                        let feed = session.dialogData.searchResults;
                        let msg = new builder.Message(session)
                            .attachmentLayout(
                                builder.AttachmentLayout.list
                        );
                        feed.forEach((result, i) => {
                                let url = 
                                    "https://ecolabstage.service-now.com/sp?sys_id=" +
                                    result.sys_id +
                                    "&view=sp&id=ticket&table=incident#home";
                                msg.addAttachment(
                                    new builder.HeroCard(session)
                                    .title(result.short_description)
                                    .subtitle("Created " + result.opened_at)
                                    .text(result.description)
                                    .buttons([
                                        builder.CardAction.imBack(
                                            session, 
                                            "" + result.number, 
                                            "" + result.number
                                        )
                                    ])
                                );
                            }),
                            builder.Prompts.text(
                                session.send(msg), 
                                "Select the incident you would like to add comments to."
                            );
                        next();
                    } else {
                        session.send(
                            "You don't have any incidents reported! Good for you!"
                    );
                }
            });
        },
    (session, results) => {
        session.dialogData.incidentNumber = results.response;
        serviceNow
            .getIncidentByNumber(session.dialogData.incidentNumber)
            .then((res) => {
                session.dialogData.incidentId = res.data.result[0].sys_id;
                console.log("Incident Sys_ID " + session.dialogData.incidentId);
                builder.Prompts.text(session, "What comments would you like to add?");
            });
    },
    (session, results) => {
        session.dialogData.comments = results.response;
        console.log("Caller_ID " + session.userData.caller_id);
        serviceNow
            .updateIncident(session.dialogData, session.userData.caller_id)
            .then((res) => {
                session.send(
                    "Thanks! I was successfully able to add your comments to your incident!"
                );
                session.endDialog();
            });
        }
    ])
    .triggerAction({
        matches: "updateIncident"
    })
    .endConversationAction(
        "endUpdateIncident", "Ok. Goodbye.", {
            matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
            confirmPrompt: "Are you sure?"
    });

bot
    .dialog("/getIncident", [
        (session, results, next) => {
            if (!session.userData.caller_id) {
                session.beginDialog("/login");
            } else {
                next();
            }
        },
        (session) => {
            session.dialogData.user_name = session.userData.user_name;
            console.log(session.userData.user_name);
            session.send(
                "I understand that you want me to find your incidents in ServiceNow."
            );
            builder.Prompts.choice(
                session,
                "Did I understand you correctly?", ["Yes, show my most recently opened incidents.", "No, not now."], { listStyle: builder.ListStyle.button }
            );
            
        },
        (session, results, next) => {
            if (results.response.entity === "Yes, show my most recently opened incidents.") {
                next();
            } else {
                session.send(
                    "Sorry I misunderstood! Maybe I can help with something else?"
                );
                session.endDialog();
            }
        },
        (session) => {
        serviceNow.getIncidents(session.userData.caller_id)
            .then((res) => {
                console.log("Successfully queried Incidents");
                console.log(res);
                if (res.data.result.length > 0) {
                    session.dialogData.searchResults = res.data.result;
                    session.send("Here's what I found:");
                    let feed = session.dialogData.searchResults;
                    let msg = new builder.Message(session).attachmentLayout(
                        builder.AttachmentLayout.list
                    );
                    feed.forEach((result, i) => {
                            let url = 
                                "https://ecolabstage.service-now.com/sp?sys_id=" +
                                result.sys_id +
                                "&view=sp&id=ticket&table=incident#home"
                            msg.addAttachment(
                                new builder.HeroCard(session)
                                .title(result.short_description)
                                .subtitle("Created " + result.opened_at)
                                .text(result.number)
                                .buttons([
                                    builder.CardAction.openUrl(session, url, "Review Incident")
                                ])
                            );
                        }),
                        session.send(msg);
                    session.endDialog();
                } else {
                    session.send(
                        "You don't have any incidents reported! Good for you!"
                    );
                    session.endDialog();
                }
            });
        }
    ])
    .triggerAction({
        matches: "getIncident"
    })
    .endConversationAction("endGetIncident", "Ok. Goodbye.", {
            matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
            confirmPrompt: "Are you sure?"
    });

bot
    .dialog("/reopenIncident", [
        (session, results, next) => {
            if (!session.userData.caller_id) {
                session.beginDialog("/login");
            } else {
                next();
            }
        },
        (session) => {
            session.send("Great, I see that you want to re-open an incident");
            builder.Prompts.text(
                session, 
                "What incident number would you like to re-open?"
            );
        },
        (session, results) => {
            session.dialogData.number = results.response;
            builder.Prompts.choice(
                session, 
                "Would you like to add any notes to the incident?", ["Yes", "No"], { listStyle: builder.ListStyle.button }
            );
        },
        (session, results, next) => {
            if (results.response.entity === "Yes") {
                builder.Prompts.text(session, "Go ahead");
                next();
            } else {
                serviceNow
                    .reopenIncident(session.dialogData)
                    .then((res) => {
                        session.endDialog();
                    })
                    .catch((err) => {
                        console.log("ERR", err);
                    });
                    next();
            }
        },
        (session, results) => {
            session.dialogData.notes = results.response;
            session.dialogData.caller_id = session.userData.caller_id;
            serviceNow.reopenIncident(session.dialogData)
                .then((res) => {
                    console.log("Reopened Incident", res);
                    session.endDialog();
                });
            }
        ]
    )
    .triggerAction({
        matches: "reopenIncident"
    })
    .endConversationAction(
        "endReopenIncident", "Ok. Goodbye.", {
            matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
            confirmPrompt: "Are you sure?"
        }
    );

bot
    .dialog("/resolveIncident", [
        (session, results, next) => {
            if (!session.userData.caller_id) {
                session.beginDialog("/login");
            } else {
                next();
            }
        },
    (session) => {
        session.dialogData.user_name = session.userData.user_name;
        console.log(session.userData.user_name);
        session.send(
            "I understand that you want to resolve a ServiceNow incident"
        );
        builder.Prompts.choice(
            session,
            "Did I understand you correctly?", ["Yes, resolve an incident for me.", "No, not now."], { listStyle: builder.ListStyle.button }
        );
    },
    (session, results, next) => {
        if (results.response.entity === "Yes, resolve an incident for me.") {
            next();
        } else {
            session.send(
                "Sorry I misunderstood! Maybe I can help with something else?"
            );
            session.endDialog();
        }
    },
    (session, results, next) => {
        serviceNow.getIncidents(session.userData.caller_id)
            .then((res) => {
                console.log("Successfully queried Incidents");
                console.log(res);
                if (res.data.result.length > 0) {
                    session.dialogData.searchResults = res.data.result;
                    session.send(
                        "Here are your 5 most recently unresolved incidents in ServiceNow:"
                    );
                    let feed = session.dialogData.searchResults;
                    let msg = new builder.Message(session)
                        .attachmentLayout(builder.AttachmentLayout.list
                    );
                    feed.forEach((result, i) => {
                            let url =
                                "https://ecolabstage.service-now.com/sp?sys_id=" +
                                result.sys_id + 
                                "&view=sp&id=ticket&table=incident#home";
                            msg.addAttachment(
                                new builder.HeroCard(session)
                                .title(result.short_description)
                                .subtitle("Created " + result.opened_at)
                                .text(result.description)
                                .buttons([
                                    builder.CardAction.imBack(
                                        session, 
                                        "" + result.number, 
                                        "" + result.number
                                    )
                                ])
                            );
                        }),
                        builder.Prompts.text(
                            session.send(msg), 
                            "Select the incident you would like to resolve"
                        );
                    next();    
                } else {
                    session.send(
                        "You don't have any incidents reported! Good for you!"
                    );
                    session.endDialog();
                }
            });
    },
    (session, results, next) => {
        session.dialogData.incidentNumber = results.response;
        console.log(
            "Dialog Data Incident Number is: " + session.dialogData.incidentNumber
        );
        serviceNow
            .getIncidentByNumber(session.dialogData.incidentNumber)
            .then((res) => {
                session.dialogData.incidentId = res.data.result[0].sys_id;
                console.log(
                    "Dialog Data Incident ID is: " + session.dialogData.incidentId
                );
                next();
            });
        },
        (session) => {
            console.log(
                "Dialog Data Incident ID is: " + session.dialogData.incidentId
            );
            console.log(session.userData.caller_id);
            serviceNow
                .resolveIncident(session.dialogData, session.userData.caller_id)
                .then((res) => {
                    session.send(
                        "You got it! I was successfully able to resolve your incident!"
                    );
                session.endDialog();
            });
        }
    ])
    .triggerAction({
        matches: "resolveIncident"
    })
    .endConversationAction("endResolveIncident", "Ok. Goodbye.", {
            matches: /^cancel$|^goodbye$|^nevermind$|^never mind$|^exit$|^quit$|^start over$/i,
            confirmPrompt: "Are you sure?"
    });

bot
    .dialog("/None", [
        (session) => {
            session.send(
                "Oops! I didn't understand what you said, " + 
                session.message.user.name + 
                "! Either I'm not sure how to respond, or I may not have the answer right now. You could always \
                try to rephrase your question and I'll try again to find you an answer!"
            );
            session.beginDialog("/");
        }
    ])
    .triggerAction({
        matches: "None"
    });