import express from "express";
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
app.use(cors({
    origin: "*",
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'PUT', 'POST', 'DELETE'],
}));

const sockets = new Server(server);

const game = {
    players: {},
    rooms: {},
    match: {}
};

const gameConfig = {
    width: 1000,
    height: 580
};

sockets.on('connection', (socket) => {
    console.log(`${socket.id} conectado.`);
    
    const name = "Player_" + socket.id.substring(0, 5);
    game.players[socket.id] = {name};
    sendMessage('game', `${game.players[socket.id].name} entrou.`);

    refreshPlayers();
    refreshRooms();

    socket.on('disconnect', () => {
        sendMessage('game', `${game.players[socket.id].name} saiu.`); 
        leaveRoom(socket);

        delete game.players[socket.id];
        refreshPlayers();
        refreshRooms();
    });

    socket.on('sendMessage', (message) => {
        sendMessage(game.players[socket.id].name, message); 
    });

    socket.on('createRoom', () => {
        socket.join(socket.id);
        game.rooms[socket.id] = {
            name: `Sala de ${game.players[socket.id].name}`, 
            player1: game.players[socket.id].name,
            player2: undefined,
        };
        game.players[socket.id].room = socket.id;

        refreshPlayers();
        refreshRooms();
        sendMessage('game', `${game.players[socket.id].name} criou uma sala.`);
    });
    
    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);

        const position = game.rooms[roomId].player1 ? '2' : '1';
        
        game.rooms[roomId][`player${position}`] = game.players[socket.id].name;  

        game.players[socket.id].room = roomId;

        const room = game.rooms[roomId];
        if (room.player1 && room.player2) {
            game.match[roomId] = {
                gameConfig,
                player1: { 
                    ready: false, 
                    x: 5,
                    y: gameConfig.height / 2 - 40,
                    height: 80,
                    width: 10,
                    speed: 5,
                },
                player2: { 
                    ready: false,
                    x: gameConfig.width - 15,
                    y: gameConfig.height / 2 - 40,
                    height: 80,
                    width: 10,
                    speed: 5,
                },
                score1: 0,
                score2: 0,
                status: 'START'
            };

            gameInProgress(roomId);
        }

        console.log(game.rooms);
        refreshPlayers();
        refreshRooms();
        refreshMatch(roomId);
        sendMessage('game', `${game.players[socket.id].name} entrou em uma sala.`);
    });

    socket.on('leaveRoom', () => {
        leaveRoom(socket);

        refreshPlayers();
        refreshRooms();
        sendMessage('game', `${game.players[socket.id].name} deixou a sala.`);  
    });

    socket.on('gameLoaded', () => {
        const roomId = game.players[socket.id].room;
        const match = game.match[roomId];
        const player = 'player' + (game.rooms[roomId].player1 == game.players[socket.id].name ? 1 : 2);

        match[player] = { ...match[player], ready: true };

        if (match.player1.ready && match.player2.ready) {
            match.status = 'PLAY';
            match.ball = {
                width: 5,
                xdirection: 1,
                ydirection: 1,
                xspeed: 2.8,
                yspeed: 2.2,
                x: gameConfig.width / 2,
                y: gameConfig.height / 2
            };
        }
    });

    socket.on('sendKey', ({ type, key }) => {
        const player = game.players[socket.id];
        const roomId = player.room;
        const room = game.rooms[roomId];
        const playerNumber = 'player' + (game.players[socket.id].name === room.player1 ? 1 : 2);
        const match = game.match[roomId];
        const direction = type === 'keyup' ? 'STOP' : key.replace('Arrow', '').toUpperCase();
        
        match[playerNumber] = { ...match[playerNumber], direction };
    });
});

const leaveRoom = (socket) => {
    if (game.players[socket.id].room) {
        const roomId = game.players[socket.id].room;
        const room = game.rooms[roomId];
        const match = game.match[roomId];
        
        game.players[socket.id].room = undefined;

        const playerNumber = 'player' + (game.players[socket.id].name == room.player1 ? 1 : 2);
        room[playerNumber] = undefined;
        
        if (match) {
            match[playerNumber] = undefined;
            match.message = `O jogador ${game.players[socket.id].name} desconectou.`;
            match.status = 'END'
        }

        if (!room.player1 && !room.player2) {
            delete game.rooms[roomId];
            if (match) {
                delete game.match[roomId];
            }
        }
        
        refreshMatch(roomId);
        socket.leave(roomId);
    }
};

const gameInProgress = (roomId) => {
    const match = game.match[roomId];
    if (!match || match.status === 'END') {
        return;
    }

    switch (match.status) {
        case 'PLAY':
            moveBall(match);
            movePaddle(match);
            checkCollision(match);
            break; 
    }

    refreshMatch(roomId);

    setTimeout(() => gameInProgress(roomId), 1000 / 30);
};

const moveBall = (match) => {
    const { ball } = match;
    const xpos = ball.x + ball.xspeed * ball.xdirection;
    const ypos = ball.y + ball.yspeed * ball.ydirection;

    ball.x = xpos;
    ball.y = ypos;
};

const movePaddle = (match) => {
    [1, 2].forEach((i) => {
        const player = match[`player${i}`];

        switch (player.direction) {
            case 'UP':
                player.y -= player.speed;
                break;
            case 'DOWN':
                player.y += player.speed;
                break;
        }

        if (player.y < 0) {
            player.y = 0;
        } else if (player.y + player.height > match.gameConfig.height) {
            player.y = match.gameConfig.height - player.height;
        }
    });
};

const checkCollision = (match) => {
    const { ball, gameConfig } = match;

    if (ball.y > gameConfig.height - ball.width || ball.y < ball.width) {
        ball.ydirection *= -1;
    }

    const { x: bx, y: by, width: br } = ball;

    const playerNumber = bx < gameConfig.width / 2 ? 1 : 2;
    const player = `player${playerNumber}`;
    const { x: rx, y: ry, width: rw, height: rh } = match[player];

    let testX = bx;
    let testY = by;


    if (bx < rx) {
        testX = rx;
    } 
    else if (bx > rx + rw) {
        testX = rx + rw;
    }

    if (by < ry) {  
        testY = ry;
    } 
    else if (by > ry + rh) {
        testY = ry + rh;
    }

    const distX = bx - testX;
    const distY = by - testY;
    const distance = Math.sqrt((distX * distX) + (distY * distY));

    if (distance <= br) {
        ball.xdirection *= -1;
        ball.x = playerNumber === 1 ? match[player].x + match[player].width + br : match[player].x - br; 
    } else if (ball.x < ball.width) {
        match.score2++;
        restartMatch(match);
    } else if (ball.x > gameConfig.width - ball.width) {
        match.score1++;
        restartMatch(match);
    }
};

const restartMatch = (match) => {
    const { ball, gameConfig } = match;
    ball.xdirection *= -1;
    ball.x = gameConfig.width / 2;
    ball.y = gameConfig.height / 2; 
};

const refreshPlayers = () => {
    sockets.emit('refreshPlayers', game.players);
};

const refreshRooms = () => {
    sockets.emit('refreshRooms', game.rooms);
};

const refreshMatch = (roomId) => {
    sockets.to(roomId).emit('refreshMatch', game.match[roomId] || {});
}

const sendMessage = (sender, message) => {
    sockets.emit('receiveMessage', {sender: sender, message: message});
};

const PORT = process.env.PORT || 4000;
server.listen(PORT, () =>{
    console.log(`O servidor está rodando na porta ${PORT}`);
});