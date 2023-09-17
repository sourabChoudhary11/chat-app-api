import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import jwt from "jsonwebtoken"
import cors from "cors"
import bcrypt from "bcryptjs"
import { UserModel } from "./models/User.js";
import MessageModel from "./models/Message.js";
import cookieParser from "cookie-parser";
import fs from "fs"
import { WebSocketServer } from "ws";

dotenv.config();

mongoose.connect(process.env.MONGO_URL, {
    dbName: "ChatApp"
}).then(data => {
    console.log(`Your are connected with database ${data.connection.host} successfully`)
}).catch(err => {
    console.log(err);
})

const app = express();
app.use('/uploads', express.static(process.cwd() + "/uploads"))
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.json())
app.use(cors({
    origin: [process.env.CLIENT_URL],
    methods: ["POST", "GET", "PUT", "DELETE"],
    credentials: true,
}))

const tokenSecret = process.env.JWT_SECRET;

app.get('/profile', async (req, res) => {
    const { token } = req.cookies;

    if (!token) return res.status(404).json({
        message: "Token is not present",
    })

    const userData = await jwt.verify(token, tokenSecret);
    res.status(200).json(userData);
});


app.get('/people', async (req, res) => {
    const users = await UserModel.find({}, { '_id': 1, username: 1 });
    res.json(users);
})

app.get('/messages/:userId', async (req, res) => {
    const { token } = req.cookies;
    const userData = await jwt.verify(token, tokenSecret);
    const ourId = userData.userId;
    const { userId } = req.params;
    const messages = await MessageModel.find({
        sender: { $in: [ourId, userId] },
        recipient: { $in: [ourId, userId] },
    })
    res.status(200).json(messages);
})

app.get('/logout', async (req, res) => {
    const { token } = req.cookies;
    if (token) return res.status(200).cookie('token', '', {
        sameSite: 'none',
        secure: true,
    }).json("logout successfully")
})

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = username.toLowerCase();
        const userExist = await UserModel.findOne({ username: user });

        if (userExist) return res.status(409).json("user already exist")

        const hashedPassword = await bcrypt.hash(password, 10);
        const createUser = await UserModel.create({
            username: user,
            password: hashedPassword,
        })

        const token = await jwt.sign({ userId: createUser._id, username: user }, tokenSecret);
        res.status(201).cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 1000,
            sameSite: "none",
            secure: true,
        }).json({
            id: createUser._id,
            username: createUser.username,
        })

    } catch (error) {
        res.status(500).json("internet connection failed")
    }
})

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = username.toLowerCase();
    try {
        const userMatch = await UserModel.findOne({ username: user }).select("+password");
        if (!userMatch) return res.status(401).json("incorrect username or password")

        const matchPassword = await bcrypt.compare(password, userMatch.password);
        if (!matchPassword) return res.status(401).json("incorrect username or password")

        const token = jwt.sign({ userId: userMatch._id, username: user }, tokenSecret)

        res.status(200).cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 1000,
            sameSite: "none",
            secure: true,
        })
        res.status(200).json({
            id: userMatch._id,
            username: userMatch.username,
        });

    } catch (error) {
        res.status(500).json("internet connection failed")
    }

})

const server = app.listen(4000);

const wss = new WebSocketServer({ server });

wss.on('connection', (connection, req) => {

    function notifyAboutOnlinePeople() {
        [...wss.clients].forEach(client => {
            client.send(JSON.stringify(
                {
                    online: [...wss.clients].map(c => ({ userId: c.userId, username: c.username }))
                }
            ))
        })
    }

    connection.isAlive = true;

    connection.timer = setInterval(() => {
        connection.ping();
        connection.disConnectTimer = setTimeout(() => {
            connection.isAlive = false;
            clearInterval(connection.timer)
            connection.terminate();
            notifyAboutOnlinePeople();
        }, 10)
    }, 1500)


    //read the username and userid for this connection
    const cookies = req.headers.cookie;
    if (cookies) {
        const tokenCookieString = cookies.split(";").find(str => str.startsWith("token="));
        if (tokenCookieString) {
            const token = tokenCookieString.split("=")[1]
            if (token) {
                const decodedToken = jwt.verify(token, tokenSecret);
                const { username, userId } = decodedToken;
                connection.username = username;
                connection.userId = userId;
            }
        }
    }


    connection.on('message', async (message) => {
        const messageData = JSON.parse(message.toString())
        const { recipient, text, file } = messageData.message;
        let fileName;

        console.log("Our data sent", messageData.message)

        if (file) {
            const fileSplit = file.name.split('.');
            const ext = fileSplit[fileSplit.length - 1];
            fileName = Date.now() + '.' + ext;
            const path = process.cwd() + '/uploads/' + fileName;
            const bufferData = new Buffer(file.data.split(',')[1], 'base64');
            fs.writeFile(path, bufferData, () => {
                console.log('file saved', path);
            });
        }
        if (recipient && (text || file)) {
            const messageDoc = await MessageModel.create({
                sender: connection.userId,
                recipient,
                text,
                file: file ? fileName : null,
            });
            [...wss.clients]
                .filter(c => c.userId === recipient)
                .forEach(client => client.send(JSON.stringify({
                    text,
                    recipient,
                    file:file?fileName:null,
                    sender: connection.userId,
                    id: messageDoc._id,
                })));
        }
    });

    // notify when someone is online

    notifyAboutOnlinePeople();
})