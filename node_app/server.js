// Import các thư viện cần thiết
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises; // Sử dụng fs.promises để làm việc bất đồng bộ với file
const bcrypt = require('bcryptjs'); // Import bcryptjs
const multer = require('multer'); // Import multer để xử lý tải file
const path = require('path'); // Import thư viện path

// Khởi tạo ứng dụng Express
const app = express();
const PORT = process.env.PORT || 3000; 

// Đường dẫn đến file "database"
const USERS_FILE = path.join(__dirname, 'users.json');
const POSTS_FILE = path.join(__dirname, 'posts.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json'); // Sẽ dùng sau cho tính năng chat

// Cấu hình Multer để lưu trữ file ảnh
const UPLOAD_DIR = path.join(__dirname, 'uploads/'); // Thư mục uploads nằm trong node_app
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Tạo thư mục nếu nó chưa tồn tại
        fs.mkdir(UPLOAD_DIR, { recursive: true }).then(() => {
            cb(null, UPLOAD_DIR);
        }).catch(err => {
            console.error('Lỗi khi tạo thư mục uploads:', err);
            cb(err);
        });
    },
    filename: (req, file, cb) => {
        // Đặt tên file để tránh trùng lặp: email_loaiAnh_timestamp.ext
        const email = req.body.email || req.params.email; // Lấy email từ body hoặc params
        const fileExtension = file.originalname.split('.').pop();
        const fileName = `${email.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${fileExtension}`;
        cb(null, fileName);
    }
});
const upload = multer({ storage: storage });

// Middleware:
app.use(express.json());
app.use(cors());

// Cung cấp các file tĩnh từ thư mục 'uploads' (nằm trong node_app)
app.use('/uploads', express.static(UPLOAD_DIR));

// MỚI: Phục vụ các file tĩnh từ thư mục 'frontend'
app.use(express.static(path.join(__dirname, '../frontend')));

// --- Hàm trợ giúp để đọc và ghi dữ liệu người dùng/bài đăng ---

/**
 * Tải dữ liệu từ file JSON.
 * @param {string} filePath Đường dẫn đến file JSON.
 * @param {object|Array} defaultData Dữ liệu mặc định trả về nếu file không tồn tại/trống.
 * @returns {Promise<object|Array>} Dữ liệu từ file JSON.
 */
async function loadData(filePath, defaultData) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        // Kiểm tra xem file có trống không trước khi parse
        if (data.trim() === '') {
            return defaultData;
        }
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT' || error.name === 'SyntaxError') {
            // File không tồn tại hoặc lỗi cú pháp (có thể là file trống)
            return defaultData;
        }
        console.error(`Lỗi khi đọc file ${filePath}:`, error);
        throw new Error(`Không thể đọc dữ liệu từ ${filePath}.`);
    }
}

/**
 * Lưu dữ liệu vào file JSON.
 * @param {string} filePath Đường dẫn đến file JSON.
 * @param {object|Array} data Dữ liệu cần lưu.
 * @returns {Promise<void>}
 */
async function saveData(filePath, data) {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 4), 'utf8');
    } catch (error) {
        console.error(`Lỗi khi ghi vào file ${filePath}:`, error);
        throw new Error(`Không thể ghi dữ liệu vào ${filePath}.`);
    }
}

// --- Các Endpoint API của Node.js ---

// Endpoint đăng ký người dùng
app.post('/api/register', async (req, res) => {
    console.log('Nhận yêu cầu đăng ký:', req.body);
    const { email, password, username } = req.body; // Thêm username

    if (!email || !password || !username) { // Kiểm tra username
        return res.status(400).json({ message: 'Vui lòng cung cấp email, mật khẩu và tên đăng nhập.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});

        if (users[email]) {
            return res.status(409).json({ message: 'Email này đã được đăng ký.' });
        }

        // MỚI: Kiểm tra xem username đã tồn tại chưa
        const usernameExists = Object.values(users).some(user => user.username && user.username.toLowerCase() === username.toLowerCase());
        if (usernameExists) {
            return res.status(409).json({ message: 'Tên đăng nhập này đã được sử dụng. Vui lòng chọn tên khác.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        users[email] = {
            username: username, // Lưu username
            password: hashedPassword,
            profile: {
                avatar: '',
                coverPhoto: '',
                status: '',
                mood: '',
                isOnline: false
            },
            friends: [], // MỚI: Danh sách bạn bè (email của bạn bè)
            friendRequestsSent: [], // MỚI: Yêu cầu kết bạn đã gửi
            friendRequestsReceived: [] // MỚI: Yêu cầu kết bạn đã nhận
        };
        await saveData(USERS_FILE, users);

        console.log(`Người dùng mới đã đăng ký: ${email}, Username: ${username}`);
        res.status(201).json({ message: 'Đăng ký thành công!' });

    } catch (error) {
        console.error('Lỗi khi đăng ký người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi đăng ký.' });
    }
});

// Endpoint đăng nhập người dùng
app.post('/api/login', async (req, res) => {
    console.log('Nhận yêu cầu đăng nhập:', req.body);
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Vui lòng cung cấp email và mật khẩu.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});
        const user = users[email];

        if (!user) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            console.log(`Người dùng đã đăng nhập: ${email}`);
            if (user.profile) {
                user.profile.isOnline = true;
                await saveData(USERS_FILE, users);
            }
            res.status(200).json({ message: 'Đăng nhập thành công!', user: { email, username: user.username, profile: user.profile } });
        } else {
            res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
        }

    } catch (error) {
        console.error('Lỗi khi đăng nhập người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi đăng nhập.' });
    }
});

// Endpoint đăng xuất người dùng (cập nhật trạng thái isOnline về false)
app.post('/api/logout', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Vui lòng cung cấp email.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});
        if (users[email] && users[email].profile) {
            users[email].profile.isOnline = false;
            await saveData(USERS_FILE, users);
            console.log(`Người dùng ${email} đã đăng xuất.`);
            res.status(200).json({ message: 'Đăng xuất thành công.' });
        } else {
            res.status(404).json({ message: 'Người dùng không tồn tại.' });
        }
    } catch (error) {
        console.error('Lỗi khi đăng xuất người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi đăng xuất.' });
    }
});

// Endpoint lấy thông tin profile của một người dùng
app.get('/api/profile/:email', async (req, res) => {
    const userEmail = req.params.email;
    try {
        const users = await loadData(USERS_FILE, {});
        const user = users[userEmail];
        if (user && user.profile) {
            res.status(200).json({
                email: userEmail,
                username: user.username,
                profile: user.profile,
                friends: user.friends || [],
                friendRequestsSent: user.friendRequestsSent || [],
                friendRequestsReceived: user.friendRequestsReceived || []
            });
        } else {
            res.status(404).json({ message: 'Người dùng không tồn tại hoặc không có thông tin profile.' });
        }
    } catch (error) {
        console.error('Lỗi khi lấy thông tin profile:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi lấy thông tin profile.' });
    }
});

// Endpoint để cập nhật thông tin profile (trạng thái, cảm xúc)
app.put('/api/profile/:email', async (req, res) => {
    const userEmail = req.params.email;
    const { status, mood, isOnline } = req.body;

    try {
        const users = await loadData(USERS_FILE, {});
        if (!users[userEmail]) {
            return res.status(404).json({ message: 'Người dùng không tồn tại.' });
        }

        if (users[userEmail].profile) {
            if (status !== undefined) users[userEmail].profile.status = status;
            if (mood !== undefined) users[userEmail].profile.mood = mood;
            if (isOnline !== undefined) users[userEmail].profile.isOnline = isOnline;
        } else {
            users[userEmail].profile = {
                avatar: '',
                coverPhoto: '',
                status: status || '',
                mood: mood || '',
                isOnline: isOnline || false
            };
        }

        await saveData(USERS_FILE, users);
        console.log(`Profile của ${userEmail} đã được cập nhật.`);
        res.status(200).json({ message: 'Cập nhật profile thành công!', profile: users[userEmail].profile });

    } catch (error) {
        console.error('Lỗi khi cập nhật profile:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi cập nhật profile.' });
    }
});

// Endpoint để tải lên ảnh đại diện
app.post('/api/profile/:email/avatar', upload.single('avatar'), async (req, res) => {
    const userEmail = req.params.email;
    if (!req.file) {
        return res.status(400).json({ message: 'Vui lòng chọn một file ảnh.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});
        if (!users[userEmail]) {
            await fs.unlink(req.file.path);
            return res.status(404).json({ message: 'Người dùng không tồn tại.' });
        }

        const avatarPath = `/uploads/${req.file.filename}`;
        if (users[userEmail].profile) {
            users[userEmail].profile.avatar = avatarPath;
        } else {
            users[userEmail].profile = {
                avatar: avatarPath,
                coverPhoto: '',
                status: '',
                mood: '',
                isOnline: false
            };
        }
        await saveData(USERS_FILE, users);

        console.log(`Ảnh đại diện của ${userEmail} đã được cập nhật: ${avatarPath}`);
        res.status(200).json({ message: 'Cập nhật ảnh đại diện thành công!', avatarUrl: avatarPath });

    } catch (error) {
        console.error('Lỗi khi cập nhật ảnh đại diện:', error);
        if (req.file && req.file.path) {
            await fs.unlink(req.file.path).catch(err => console.error('Lỗi khi xóa file ảnh lỗi:', err));
        }
        res.status(500).json({ message: 'Đã xảy ra lỗi khi cập nhật ảnh đại diện.' });
    }
});

// Endpoint để tải lên ảnh nền
app.post('/api/profile/:email/cover-photo', upload.single('coverPhoto'), async (req, res) => {
    const userEmail = req.params.email;
    if (!req.file) {
        return res.status(400).json({ message: 'Vui lòng chọn một file ảnh.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});
        if (!users[userEmail]) {
            await fs.unlink(req.file.path);
            return res.status(404).json({ message: 'Người dùng không tồn tại.' });
        }

        const coverPhotoPath = `/uploads/${req.file.filename}`;
        if (users[userEmail].profile) {
            users[userEmail].profile.coverPhoto = coverPhotoPath;
        } else {
            users[userEmail].profile = {
                avatar: '',
                coverPhoto: coverPhotoPath,
                status: '',
                mood: '',
                isOnline: false
            };
        }
        await saveData(USERS_FILE, users);

        console.log(`Ảnh nền của ${userEmail} đã được cập nhật: ${coverPhotoPath}`);
        res.status(200).json({ message: 'Cập nhật ảnh nền thành công!', coverPhotoUrl: coverPhotoPath });

    } catch (error) {
        console.error('Lỗi khi cập nhật ảnh nền:', error);
        if (req.file && req.file.path) {
            await fs.unlink(req.file.path).catch(err => console.error('Lỗi khi xóa file ảnh lỗi:', err));
        }
        res.status(500).json({ message: 'Đã xảy ra lỗi khi cập nhật ảnh nền.' });
    }
});

// Endpoint tạo bài đăng mới
app.post('/api/posts', async (req, res) => {
    console.log('Nhận yêu cầu tạo bài đăng:', req.body);
    const { author_email, content } = req.body;

    if (!author_email || !content) {
        return res.status(400).json({ message: 'Vui lòng cung cấp email người đăng và nội dung.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});
        if (!users[author_email]) {
            return res.status(404).json({ message: 'Người dùng không tồn tại.' });
        }

        const posts = await loadData(POSTS_FILE, []);
        const newPost = {
            id: posts.length > 0 ? Math.max(...posts.map(p => p.id)) + 1 : 1,
            author_email,
            content,
            timestamp: Date.now()
        };
        posts.push(newPost);
        await saveData(POSTS_FILE, posts);

        console.log(`Bài đăng mới từ ${author_email}: ${content}`);
        res.status(201).json({ message: 'Bài đăng đã được tạo thành công!', post: newPost });

    } catch (error) {
        console.error('Lỗi khi tạo bài đăng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi tạo bài đăng.' });
    }
});

// Endpoint lấy tất cả bài đăng
app.get('/api/posts', async (req, res) => {
    console.log('Nhận yêu cầu lấy bài đăng.');
    try {
        const posts = await loadData(POSTS_FILE, []);
        const sortedPosts = posts.sort((a, b) => b.timestamp - a.timestamp);
        res.status(200).json(sortedPosts);
    } catch (error) {
        console.error('Lỗi khi lấy bài đăng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi lấy bài đăng.' });
    }
});

// MỚI: Endpoint tìm kiếm người dùng theo username/email
app.get('/api/users/search', async (req, res) => {
    const searchTerm = req.query.q;
    if (!searchTerm) {
        return res.status(400).json({ message: 'Vui lòng cung cấp từ khóa tìm kiếm.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});
        const normalizedSearchTerm = searchTerm.toLowerCase();

        const searchResults = Object.keys(users)
            .filter(email => {
                const user = users[email];
                return (user.username && user.username.toLowerCase().includes(normalizedSearchTerm)) ||
                       (email.toLowerCase().includes(normalizedSearchTerm));
            })
            .map(email => {
                const user = users[email];
                return {
                    email: email,
                    username: user.username,
                    avatar: user.profile ? user.profile.avatar : '',
                    isOnline: user.profile ? user.profile.isOnline : false
                };
            });

        res.status(200).json(searchResults);

    } catch (error) {
        console.error('Lỗi khi tìm kiếm người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi tìm kiếm người dùng.' });
    }
});

// MỚI: Endpoint để gửi yêu cầu kết bạn
app.post('/api/friend-request/send', async (req, res) => {
    const { senderEmail, receiverEmail } = req.body;

    if (!senderEmail || !receiverEmail) {
        return res.status(400).json({ message: 'Vui lòng cung cấp email người gửi và người nhận.' });
    }
    if (senderEmail === receiverEmail) {
        return res.status(400).json({ message: 'Không thể gửi yêu cầu kết bạn cho chính mình.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});
        const sender = users[senderEmail];
        const receiver = users[receiverEmail];

        if (!sender || !receiver) {
            return res.status(404).json({ message: 'Người gửi hoặc người nhận không tồn tại.' });
        }

        if (sender.friends.includes(receiverEmail)) {
            return res.status(400).json({ message: 'Hai bạn đã là bạn bè.' });
        }
        if (sender.friendRequestsSent.includes(receiverEmail)) {
            return res.status(400).json({ message: 'Bạn đã gửi yêu cầu kết bạn đến người này rồi.' });
        }
        if (sender.friendRequestsReceived.includes(receiverEmail)) {
            return res.status(400).json({ message: 'Người này đã gửi yêu cầu kết bạn cho bạn. Vui lòng chấp nhận.' });
        }

        sender.friendRequestsSent.push(receiverEmail);
        receiver.friendRequestsReceived.push(senderEmail);

        await saveData(USERS_FILE, users);
        console.log(`Yêu cầu kết bạn từ ${senderEmail} đến ${receiverEmail} đã được gửi.`);
        res.status(200).json({ message: 'Yêu cầu kết bạn đã được gửi!' });

    } catch (error) {
        console.error('Lỗi khi gửi yêu cầu kết bạn:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi gửi yêu cầu kết bạn.' });
    }
});

// MỚI: Endpoint để chấp nhận yêu cầu kết bạn
app.post('/api/friend-request/accept', async (req, res) => {
    const { receiverEmail, senderEmail } = req.body;

    if (!senderEmail || !receiverEmail) {
        return res.status(400).json({ message: 'Vui lòng cung cấp email người gửi và người nhận.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});
        const receiver = users[receiverEmail];
        const sender = users[senderEmail];

        if (!sender || !receiver) {
            return res.status(404).json({ message: 'Người dùng không tồn tại.' });
        }

        const requestIndex = receiver.friendRequestsReceived.indexOf(senderEmail);
        if (requestIndex === -1) {
            return res.status(400).json({ message: 'Không tìm thấy yêu cầu kết bạn từ người này.' });
        }

        receiver.friends.push(senderEmail);
        sender.friends.push(receiverEmail);

        receiver.friendRequestsReceived.splice(requestIndex, 1);
        const sentIndex = sender.friendRequestsSent.indexOf(receiverEmail);
        if (sentIndex !== -1) {
            sender.friendRequestsSent.splice(sentIndex, 1);
        }

        await saveData(USERS_FILE, users);
        console.log(`${receiverEmail} đã chấp nhận yêu cầu kết bạn từ ${senderEmail}.`);
        res.status(200).json({ message: 'Đã chấp nhận yêu cầu kết bạn!', newFriend: senderEmail });

    } catch (error) {
        console.error('Lỗi khi chấp nhận yêu cầu kết bạn:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi chấp nhận yêu cầu kết bạn.' });
    }
});

// MỚI: Endpoint để hủy/từ chối yêu cầu kết bạn hoặc hủy kết bạn
app.post('/api/friend-request/cancel-reject-unfriend', async (req, res) => {
    const { userEmail, targetEmail, type } = req.body;

    if (!userEmail || !targetEmail || !type) {
        return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ thông tin.' });
    }

    try {
        const users = await loadData(USERS_FILE, {});
        const user = users[userEmail];
        const target = users[targetEmail];

        if (!user || !target) {
            return res.status(404).json({ message: 'Người dùng không tồn tại.' });
        }

        if (type === 'cancel') { // Hủy yêu cầu đã gửi
            const index = user.friendRequestsSent.indexOf(targetEmail);
            if (index !== -1) user.friendRequestsSent.splice(index, 1);
            const targetIndex = target.friendRequestsReceived.indexOf(userEmail);
            if (targetIndex !== -1) target.friendRequestsReceived.splice(targetIndex, 1);
            console.log(`${userEmail} đã hủy yêu cầu kết bạn đến ${targetEmail}.`);
            res.status(200).json({ message: 'Đã hủy yêu cầu kết bạn.' });

        } else if (type === 'reject') { // Từ chối yêu cầu đã nhận
            const index = user.friendRequestsReceived.indexOf(targetEmail);
            if (index !== -1) user.friendRequestsReceived.splice(index, 1);
            const targetIndex = target.friendRequestsSent.indexOf(userEmail);
            if (targetIndex !== -1) target.friendRequestsSent.splice(targetIndex, 1);
            console.log(`${userEmail} đã từ chối yêu cầu kết bạn từ ${targetEmail}.`);
            res.status(200).json({ message: 'Đã từ chối yêu cầu kết bạn.' });

        } else if (type === 'unfriend') { // Hủy kết bạn
            let index = user.friends.indexOf(targetEmail);
            if (index !== -1) user.friends.splice(index, 1);
            index = target.friends.indexOf(userEmail);
            if (index !== -1) target.friends.splice(index, 1);
            console.log(`${userEmail} và ${targetEmail} đã hủy kết bạn.`);
            res.status(200).json({ message: 'Đã hủy kết bạn.' });

        } else {
            return res.status(400).json({ message: 'Loại hành động không hợp lệ.' });
        }

        await saveData(USERS_FILE, users);

    } catch (error) {
        console.error('Lỗi khi hủy/từ chối/hủy kết bạn:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi khi thực hiện hành động.' });
    }
});


// Khởi động server Node.js
app.listen(PORT, () => {
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
    console.log(`URL API hủy/từ chối/hủy KB: http://localhost:${PORT}/api/friend-request/cancel-reject-unfriend (POST)`);
});