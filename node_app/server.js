// Import các thư viện cần thiết
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises; // Sử dụng fs.promises để làm việc bất đồng bộ với file
const bcrypt = require('bcryptjs'); // Import bcryptjs
const multer = require('multer'); // Import multer để xử lý tải file
const path = require('path'); // Import thư viện path
const http = require('http'); // Import http module
const { Server } = require('socket.io'); // Import Server từ socket.io

// Khởi tạo ứng dụng Express
const app = express();
const server = http.createServer(app); // Tạo HTTP server từ app Express
const io = new Server(server, { // Khởi tạo Socket.IO server
    cors: {
        origin: "*", // Cho phép tất cả các origin truy cập (hoặc cụ thể domain frontend của bạn khi deploy)
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000; // Sử dụng cổng do môi trường cung cấp, nếu không có thì dùng 3000 (cho local)

// Đường dẫn đến file "database"
const USERS_FILE = path.join(__dirname, 'users.json');
const POSTS_FILE = path.join(__dirname, 'posts.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json'); // File lưu trữ tin nhắn

// Cấu hình Multer để lưu trữ file ảnh
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const userEmail = req.params.email;
        if (!userEmail) {
            return cb(new Error('Email người dùng không được cung cấp.'));
        }
        const userUploadDir = path.join(UPLOAD_DIR, userEmail);
        try {
            await fs.mkdir(userUploadDir, { recursive: true }); // Tạo thư mục nếu chưa có
            cb(null, userUploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Middleware
app.use(cors()); // Sử dụng CORS
app.use(express.json()); // Cho phép Express đọc JSON từ request body
app.use(express.static(path.join(__dirname, '../frontend'))); // Phục vụ các file tĩnh từ thư mục frontend
app.use('/uploads', express.static(UPLOAD_DIR)); // Phục vụ các file ảnh đã tải lên

// Hàm đọc dữ liệu từ file JSON
async function readJsonFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') { // File not found
            return [];
        }
        throw error;
    }
}

// Hàm ghi dữ liệu vào file JSON
async function writeJsonFile(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Route đăng ký
app.post('/api/register', async (req, res) => {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin.' });
    }

    try {
        const users = await readJsonFile(USERS_FILE);

        if (users.some(user => user.email === email)) {
            return res.status(409).json({ message: 'Email đã được đăng ký.' });
        }

        // Hash mật khẩu trước khi lưu
        const hashedPassword = await bcrypt.hash(password, 10); // 10 là saltRounds

        const newUser = {
            email,
            username,
            password: hashedPassword,
            profile: {
                bio: '',
                location: '',
                dob: '',
                gender: '',
                relationship: '',
                avatar: null,
                coverPhoto: null
            },
            friendRequests: [], // Danh sách các yêu cầu kết bạn đã nhận
            friends: [] // Danh sách bạn bè
        };
        users.push(newUser);
        await writeJsonFile(USERS_FILE, users);

        res.status(201).json({ message: 'Đăng ký thành công!' });
    } catch (error) {
        console.error('Lỗi khi đăng ký:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route đăng nhập
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ email và mật khẩu.' });
    }

    try {
        const users = await readJsonFile(USERS_FILE);
        const user = users.find(u => u.email === email);

        if (!user) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
        }

        // So sánh mật khẩu đã hash
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
        }

        res.status(200).json({ message: 'Đăng nhập thành công!', user: { email: user.email, username: user.username } });
    } catch (error) {
        console.error('Lỗi khi đăng nhập:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route đăng xuất
app.post('/api/logout', (req, res) => {
    // Trong một ứng dụng thực tế, bạn sẽ invalidate token hoặc session ở đây.
    // Với ứng dụng này, chỉ cần thông báo thành công.
    res.status(200).json({ message: 'Đăng xuất thành công.' });
});

// Route lấy tất cả bài đăng
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await readJsonFile(POSTS_FILE);
        // Sắp xếp bài đăng theo thời gian tạo mới nhất lên đầu
        posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.status(200).json(posts);
    } catch (error) {
        console.error('Lỗi khi lấy bài đăng:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route tạo bài đăng mới
app.post('/api/posts', upload.single('image'), async (req, res) => {
    const { content, authorEmail, authorUsername } = req.body;
    const imageUrl = req.file ? `/uploads/${authorEmail}/${req.file.filename}` : null;

    if (!content && !imageUrl) {
        return res.status(400).json({ message: 'Bài đăng không được rỗng.' });
    }
    if (!authorEmail || !authorUsername) {
        return res.status(400).json({ message: 'Thông tin tác giả không hợp lệ.' });
    }

    try {
        const posts = await readJsonFile(POSTS_FILE);
        const newPost = {
            id: Date.now().toString(), // ID duy nhất
            content,
            imageUrl,
            author: {
                email: authorEmail,
                username: authorUsername
            },
            createdAt: new Date().toISOString(),
            likes: [],
            comments: []
        };
        posts.push(newPost);
        await writeJsonFile(POSTS_FILE, posts);

        // Gửi bài đăng mới đến tất cả các client đang kết nối
        io.emit('newPost', newPost);

        res.status(201).json({ message: 'Bài đăng đã được tạo thành công!', post: newPost });
    } catch (error) {
        console.error('Lỗi khi tạo bài đăng:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route lấy thông tin profile của người dùng
app.get('/api/profile/:email', async (req, res) => {
    const userEmail = req.params.email;

    try {
        const users = await readJsonFile(USERS_FILE);
        const user = users.find(u => u.email === userEmail);

        if (!user) {
            return res.status(404).json({ message: 'Người dùng không tìm thấy.' });
        }

        // Trả về một bản sao của profile (không bao gồm mật khẩu)
        const userProfile = {
            email: user.email,
            username: user.username,
            profile: user.profile,
            friendRequests: user.friendRequests,
            friends: user.friends
        };
        res.status(200).json(userProfile);
    } catch (error) {
        console.error('Lỗi khi lấy profile:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route cập nhật thông tin profile
app.put('/api/profile/:email', async (req, res) => {
    const userEmail = req.params.email;
    const updatedProfileData = req.body; // Dữ liệu profile được gửi từ client

    try {
        const users = await readJsonFile(USERS_FILE);
        const userIndex = users.findIndex(u => u.email === userEmail);

        if (userIndex === -1) {
            return res.status(404).json({ message: 'Người dùng không tìm thấy.' });
        }

        // Cập nhật các trường profile
        users[userIndex].profile = {
            ...users[userIndex].profile,
            ...updatedProfileData
        };
        await writeJsonFile(USERS_FILE, users);

        res.status(200).json({ message: 'Profile đã được cập nhật thành công!', profile: users[userIndex].profile });
    } catch (error) {
        console.error('Lỗi khi cập nhật profile:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route tải ảnh đại diện
app.post('/api/profile/:email/avatar', upload.single('avatar'), async (req, res) => {
    const userEmail = req.params.email;
    const avatarUrl = req.file ? `/uploads/${userEmail}/${req.file.filename}` : null;

    if (!avatarUrl) {
        return res.status(400).json({ message: 'Không tìm thấy file ảnh đại diện.' });
    }

    try {
        const users = await readJsonFile(USERS_FILE);
        const userIndex = users.findIndex(u => u.email === userEmail);

        if (userIndex === -1) {
            return res.status(404).json({ message: 'Người dùng không tìm thấy.' });
        }

        // Xóa ảnh cũ nếu có
        if (users[userIndex].profile.avatar) {
            const oldAvatarPath = path.join(__dirname, '../frontend', users[userIndex].profile.avatar);
            try {
                await fs.unlink(oldAvatarPath);
            } catch (unlinkError) {
                console.warn('Không thể xóa ảnh đại diện cũ (có thể không tồn tại):', unlinkError.message);
            }
        }

        users[userIndex].profile.avatar = avatarUrl;
        await writeJsonFile(USERS_FILE, users);

        res.status(200).json({ message: 'Ảnh đại diện đã được tải lên thành công!', avatarUrl });
    } catch (error) {
        console.error('Lỗi khi tải ảnh đại diện:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route tải ảnh nền
app.post('/api/profile/:email/cover-photo', upload.single('coverPhoto'), async (req, res) => {
    const userEmail = req.params.email;
    const coverPhotoUrl = req.file ? `/uploads/${userEmail}/${req.file.filename}` : null;

    if (!coverPhotoUrl) {
        return res.status(400).json({ message: 'Không tìm thấy file ảnh nền.' });
    }

    try {
        const users = await readJsonFile(USERS_FILE);
        const userIndex = users.findIndex(u => u.email === userEmail);

        if (userIndex === -1) {
            return res.status(404).json({ message: 'Người dùng không tìm thấy.' });
        }

        // Xóa ảnh cũ nếu có
        if (users[userIndex].profile.coverPhoto) {
            const oldCoverPhotoPath = path.join(__dirname, '../frontend', users[userIndex].profile.coverPhoto);
            try {
                await fs.unlink(oldCoverPhotoPath);
            } catch (unlinkError) {
                console.warn('Không thể xóa ảnh nền cũ (có thể không tồn tại):', unlinkError.message);
            }
        }

        users[userIndex].profile.coverPhoto = coverPhotoUrl;
        await writeJsonFile(USERS_FILE, users);

        res.status(200).json({ message: 'Ảnh nền đã được tải lên thành công!', coverPhotoUrl });
    } catch (error) {
        console.error('Lỗi khi tải ảnh nền:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route tìm kiếm người dùng
app.get('/api/users/search', async (req, res) => {
    const query = req.query.q;

    if (!query) {
        return res.status(400).json({ message: 'Vui lòng cung cấp từ khóa tìm kiếm.' });
    }

    try {
        const users = await readJsonFile(USERS_FILE);
        const currentUserEmail = req.headers['x-user-email']; // Lấy email người dùng hiện tại từ header

        const searchResults = users
            .filter(user => user.username.toLowerCase().includes(query.toLowerCase()) || user.email.toLowerCase().includes(query.toLowerCase()))
            .map(user => {
                const isFriend = user.friends.includes(currentUserEmail);
                const hasSentRequest = user.friendRequests.includes(currentUserEmail); // Current user sent request to this user
                const hasReceivedRequest = users.find(u => u.email === currentUserEmail)?.friendRequests.includes(user.email); // Current user received request from this user

                return {
                    email: user.email,
                    username: user.username,
                    avatar: user.profile.avatar,
                    isFriend: isFriend,
                    requestStatus: hasSentRequest ? 'sent' : (hasReceivedRequest ? 'received' : 'none')
                };
            });

        res.status(200).json(searchResults);
    } catch (error) {
        console.error('Lỗi khi tìm kiếm người dùng:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route gửi yêu cầu kết bạn
app.post('/api/friend-request/send', async (req, res) => {
    const { fromEmail, toEmail } = req.body;

    if (!fromEmail || !toEmail) {
        return res.status(400).json({ message: 'Thông tin email không hợp lệ.' });
    }

    try {
        const users = await readJsonFile(USERS_FILE);
        const sender = users.find(u => u.email === fromEmail);
        const receiver = users.find(u => u.email === toEmail);

        if (!sender || !receiver) {
            return res.status(404).json({ message: 'Người gửi hoặc người nhận không tìm thấy.' });
        }

        // Kiểm tra nếu đã là bạn bè
        if (sender.friends.includes(toEmail)) {
            return res.status(400).json({ message: 'Hai người đã là bạn bè.' });
        }

        // Kiểm tra nếu yêu cầu đã được gửi
        if (receiver.friendRequests.includes(fromEmail)) {
            return res.status(400).json({ message: 'Yêu cầu kết bạn đã được gửi trước đó.' });
        }

        // Kiểm tra nếu người gửi đã nhận yêu cầu từ người nhận (trường hợp này nên chấp nhận luôn)
        if (sender.friendRequests.includes(toEmail)) {
            // Chấp nhận yêu cầu ngay lập tức nếu người gửi đã nhận yêu cầu từ người nhận
            sender.friends.push(toEmail);
            receiver.friends.push(fromEmail);
            sender.friendRequests = sender.friendRequests.filter(req => req !== toEmail);
            await writeJsonFile(USERS_FILE, users);
            return res.status(200).json({ message: 'Yêu cầu đã được chấp nhận (người nhận đã gửi yêu cầu cho bạn).' });
        }

        receiver.friendRequests.push(fromEmail);
        await writeJsonFile(USERS_FILE, users);

        res.status(200).json({ message: 'Yêu cầu kết bạn đã được gửi.' });
    } catch (error) {
        console.error('Lỗi khi gửi yêu cầu kết bạn:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});


// Route chấp nhận yêu cầu kết bạn
app.post('/api/friend-request/accept', async (req, res) => {
    const { acceptorEmail, senderEmail } = req.body;

    if (!acceptorEmail || !senderEmail) {
        return res.status(400).json({ message: 'Thông tin email không hợp lệ.' });
    }

    try {
        const users = await readJsonFile(USERS_FILE);
        const acceptor = users.find(u => u.email === acceptorEmail);
        const sender = users.find(u => u.email === senderEmail);

        if (!acceptor || !sender) {
            return res.status(404).json({ message: 'Người chấp nhận hoặc người gửi không tìm thấy.' });
        }

        // Kiểm tra xem yêu cầu có tồn tại không
        const requestIndex = acceptor.friendRequests.indexOf(senderEmail);
        if (requestIndex === -1) {
            return res.status(404).json({ message: 'Yêu cầu kết bạn không tồn tại.' });
        }

        // Thêm vào danh sách bạn bè của cả hai
        acceptor.friends.push(senderEmail);
        sender.friends.push(acceptorEmail);

        // Xóa yêu cầu khỏi danh sách chờ của người chấp nhận
        acceptor.friendRequests.splice(requestIndex, 1);

        await writeJsonFile(USERS_FILE, users);

        res.status(200).json({ message: 'Yêu cầu kết bạn đã được chấp nhận.' });
    } catch (error) {
        console.error('Lỗi khi chấp nhận yêu cầu kết bạn:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route từ chối yêu cầu kết bạn
app.post('/api/friend-request/reject', async (req, res) => {
    const { receiverEmail, senderEmail } = req.body;

    if (!receiverEmail || !senderEmail) {
        return res.status(400).json({ message: 'Thông tin email không hợp lệ.' });
    }

    try {
        const users = await readJsonFile(USERS_FILE);
        const receiver = users.find(u => u.email === receiverEmail);

        if (!receiver) {
            return res.status(404).json({ message: 'Người nhận không tìm thấy.' });
        }

        // Xóa yêu cầu khỏi danh sách chờ của người nhận
        const requestIndex = receiver.friendRequests.indexOf(senderEmail);
        if (requestIndex > -1) {
            receiver.friendRequests.splice(requestIndex, 1);
            await writeJsonFile(USERS_FILE, users);
            res.status(200).json({ message: 'Yêu cầu kết bạn đã bị từ chối.' });
        } else {
            res.status(404).json({ message: 'Yêu cầu kết bạn không tìm thấy.' });
        }
    } catch (error) {
        console.error('Lỗi khi từ chối yêu cầu kết bạn:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route hủy kết bạn
app.post('/api/friends/unfriend', async (req, res) => {
    const { user1Email, user2Email } = req.body;

    if (!user1Email || !user2Email) {
        return res.status(400).json({ message: 'Thông tin email không hợp lệ.' });
    }

    try {
        const users = await readJsonFile(USERS_FILE);
        const user1 = users.find(u => u.email === user1Email);
        const user2 = users.find(u => u.email === user2Email);

        if (!user1 || !user2) {
            return res.status(404).json({ message: 'Một hoặc cả hai người dùng không tìm thấy.' });
        }

        // Xóa khỏi danh sách bạn bè của user1
        const user1FriendIndex = user1.friends.indexOf(user2Email);
        if (user1FriendIndex > -1) {
            user1.friends.splice(user1FriendIndex, 1);
        } else {
            return res.status(404).json({ message: 'Hai người không phải là bạn bè.' });
        }

        // Xóa khỏi danh sách bạn bè của user2
        const user2FriendIndex = user2.friends.indexOf(user1Email);
        if (user2FriendIndex > -1) {
            user2.friends.splice(user2FriendIndex, 1);
        }

        await writeJsonFile(USERS_FILE, users);

        res.status(200).json({ message: 'Hủy kết bạn thành công.' });
    } catch (error) {
        console.error('Lỗi khi hủy kết bạn:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route gửi tin nhắn
app.post('/api/messages/send', async (req, res) => {
    const { sender, receiver, message } = req.body;

    if (!sender || !receiver || !message) {
        return res.status(400).json({ message: 'Tin nhắn không hợp lệ.' });
    }

    try {
        const messages = await readJsonFile(MESSAGES_FILE);
        const newMessage = {
            id: Date.now().toString(),
            sender,
            receiver,
            message,
            timestamp: new Date().toISOString()
        };
        messages.push(newMessage);
        await writeJsonFile(MESSAGES_FILE, messages);

        // Gửi tin nhắn qua Socket.IO
        io.to(sender).emit('privateMessage', newMessage);
        io.to(receiver).emit('privateMessage', newMessage);

        res.status(201).json({ message: 'Tin nhắn đã được gửi!', sentMessage: newMessage });
    } catch (error) {
        console.error('Lỗi khi gửi tin nhắn:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});

// Route lấy tin nhắn giữa hai người dùng
app.get('/api/messages/:user1Email/:user2Email', async (req, res) => {
    const { user1Email, user2Email } = req.params;

    try {
        const messages = await readJsonFile(MESSAGES_FILE);
        const filteredMessages = messages.filter(msg =>
            (msg.sender === user1Email && msg.receiver === user2Email) ||
            (msg.sender === user2Email && msg.receiver === user1Email)
        );
        res.status(200).json(filteredMessages);
    } catch (error) {
        console.error('Lỗi khi lấy tin nhắn:', error);
        res.status(500).json({ message: 'Lỗi server nội bộ.' });
    }
});


// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Khi người dùng gửi email, lưu lại để định danh socket
    socket.on('setUserId', (email) => {
        socket.join(email); // Thêm socket vào một phòng có tên là email của người dùng
        console.log(`User ${email} joined room`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});


// Khởi động server
server.listen(PORT, () => {
    console.log(`Server Node.js đang chạy trên cổng ${PORT}`);
    console.log(`Để truy cập ứng dụng, mở trình duyệt và vào: http://localhost:${PORT}/login.html`);
    console.log(`URL API đăng ký: http://localhost:${PORT}/api/register`);
    console.log(`URL API đăng nhập: http://localhost:${PORT}/api/login`);
    console.log(`URL API đăng xuất: http://localhost:${PORT}/api/logout (POST)`);
    console.log(`URL API tạo bài đăng: http://localhost:${PORT}/api/posts (POST)`);
    console.log(`URL API lấy bài đăng: http://localhost:${PORT}/api/posts (GET)`);
    console.log(`URL API lấy profile: http://localhost:${PORT}/api/profile/:email (GET)`);
    console.log(`URL API cập nhật profile: http://localhost:${PORT}/api/profile/:email (PUT)`);
    console.log(`URL API tải ảnh đại diện: http://localhost:${PORT}/api/profile/:email/avatar (POST)`);
    console.log(`URL API tải ảnh nền: http://localhost:${PORT}/api/profile/:email/cover-photo (POST)`);
    console.log(`URL API tìm kiếm người dùng: http://localhost:${PORT}/api/users/search?q=keyword (GET)`);
    console.log(`URL API gửi YCKB: http://localhost:${PORT}/api/friend-request/send (POST)`);
    console.log(`URL API chấp nhận YCKB: http://localhost:${PORT}/api/friend-request/accept (POST)`);
    console.log(`URL API từ chối YCKB: http://localhost:${PORT}/api/friend-request/reject (POST)`);
    console.log(`URL API hủy kết bạn: http://localhost:${PORT}/api/friends/unfriend (POST)`);
    console.log(`URL API gửi tin nhắn: http://localhost:${PORT}/api/messages/send (POST)`);
    console.log(`URL API lấy tin nhắn: http://localhost:${PORT}/api/messages/:user1Email/:user2Email (GET)`);
});
