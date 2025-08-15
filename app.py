import os
from flask import Flask, render_template, jsonify, request, url_for, session, abort, redirect, send_file
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity, decode_token
import requests
from dotenv import load_dotenv
import datetime
from flask_jwt_extended.exceptions import NoAuthorizationError
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from flask_migrate import Migrate
import os
import uuid
from werkzeug.utils import secure_filename
from flask_mail import Mail, Message as MailMessage
import secrets
import string
from email_validator import validate_email, EmailNotValidError

online_users = {}  # sid -> username
load_dotenv()

# Helper function to get user's session ID
def get_user_sid(username):
    """Get the session ID for a given username"""
    for sid, uname in online_users.items():
        if uname == username:
            return sid
    return None

db = SQLAlchemy()
migrate = Migrate()

# Message model for chat persistence
class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    # Legacy fields
    room = db.Column(db.String(128), nullable=True)
    sender = db.Column(db.String(80), nullable=True)
    message = db.Column(db.Text, nullable=True)
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    reply_to_message_id = db.Column(db.Integer, db.ForeignKey('message.id'), nullable=True)
    # Advanced fields
    room_id = db.Column(db.String(100), nullable=True)
    content = db.Column(db.Text, nullable=True)
    message_class = db.Column(db.String(100), nullable=True)
    reply_content = db.Column(db.Text)
    reply_sender = db.Column(db.String(80))
    role = db.Column(db.String(50), nullable=True, default='client')
    file_id = db.Column(db.String(100))
    file_name = db.Column(db.String(255))
    file_type = db.Column(db.String(50))
    file_size = db.Column(db.Integer)
    file_url = db.Column(db.String(255))
    color = db.Column(db.String(20))
    audio_id = db.Column(db.String(100))
    audio_url = db.Column(db.String(255))
    audio_duration = db.Column(db.Float)
    visible_to_client = db.Column(db.Boolean, default=True)
    visible_to_server = db.Column(db.Boolean, default=True)
    last_deletion_timestamp = db.Column(db.DateTime(timezone=True), nullable=True)
    reactions = db.Column(db.Text, default='{}')  # Changed to Text for SQLite compatibility
    status = db.Column(db.String(20), default='sent')  # Message status: sent, delivered, seen

    def __init__(self, *args, **kwargs):
        if 'timestamp' not in kwargs:
            kwargs['timestamp'] = datetime.datetime.now(datetime.timezone.utc)
        elif kwargs['timestamp'].tzinfo is None:
            import pytz
            kwargs['timestamp'] = pytz.UTC.localize(kwargs['timestamp'])
        if 'reactions' not in kwargs:
            kwargs['reactions'] = '{}'  # Initialize as empty JSON string
        super().__init__(*args, **kwargs)

    def get_reactions(self):
        """Convert stored JSON string to dict"""
        import json
        try:
            return json.loads(self.reactions)
        except:
            return {}

    def set_reactions(self, reactions_dict):
        """Convert dict to JSON string for storage"""
        import json
        self.reactions = json.dumps(reactions_dict)

# Audio message persistence
class AudioMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    room = db.Column(db.String(128), nullable=False)
    sender = db.Column(db.String(80), nullable=False)
    audio_data = db.Column(db.Text, nullable=False)  # base64-encoded webm
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    reactions = db.Column(db.Text, default='{}')  # JSON string for reactions
    status = db.Column(db.String(20), default='sent')  # Message status: sent, delivered, seen

    def __init__(self, *args, **kwargs):
        if 'timestamp' not in kwargs:
            kwargs['timestamp'] = datetime.datetime.now(datetime.timezone.utc)
        elif kwargs['timestamp'].tzinfo is None:
            import pytz
            kwargs['timestamp'] = pytz.UTC.localize(kwargs['timestamp'])
        if 'reactions' not in kwargs:
            kwargs['reactions'] = '{}'
        super().__init__(*args, **kwargs)

    def get_reactions(self):
        """Convert stored JSON string to dict"""
        import json
        try:
            return json.loads(self.reactions)
        except:
            return {}

    def set_reactions(self, reactions_dict):
        """Convert dict to JSON string for storage"""
        import json
        self.reactions = json.dumps(reactions_dict)

# Unread message tracker
class UnreadMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False)  # The user who has unread messages
    room = db.Column(db.String(128), nullable=False)
    count = db.Column(db.Integer, default=0)
    

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key'
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'your-secret-key')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = datetime.timedelta(days=1)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///appdata.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Flask-Mail configuration
app.config['MAIL_SERVER'] = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
app.config['MAIL_PORT'] = int(os.environ.get('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.environ.get('MAIL_USE_TLS', 'True').lower() == 'true'
app.config['MAIL_USE_SSL'] = os.environ.get('MAIL_USE_SSL', 'False').lower() == 'true'
app.config['MAIL_USERNAME'] = os.environ.get('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.environ.get('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.environ.get('MAIL_DEFAULT_SENDER', app.config['MAIL_USERNAME'])

db.init_app(app)
migrate.init_app(app, db)
mail = Mail(app)
# To create migrations, run:
# flask db init (only once), flask db migrate -m "message", flask db upgrade
with app.app_context():
    db.create_all()

jwt = JWTManager(app)
active_tokens = set()
TURN_KEY_ID = os.environ.get('TURN_KEY_ID', 'YOUR_TURN_KEY_ID')
TURN_API_TOKEN = os.environ.get('TURN_API_TOKEN', 'YOUR_TURN_API_TOKEN')
socketio = SocketIO(app, cors_allowed_origins="*")

UPLOAD_FOLDER = 'static/uploads'
ALLOWED_EXTENSIONS = {
    # Documents
    'txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx',

    # Images
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp',

    # Videos
    'mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm',

    # Audio
    'mp3', 'wav', 'ogg', 'aac', 'm4a',

    # Archives
    'zip', 'rar', '7z', 'tar', 'gz'
}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 * 1024  # 50 GB limit

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/upload_file', methods=['POST'])

def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file_id = str(uuid.uuid4())
        file_extension = filename.rsplit('.', 1)[1].lower()
        unique_filename = f"{file_id}.{file_extension}"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        file.save(file_path)

        file_url = url_for('static', filename=f'uploads/{unique_filename}', _external=True)
        if file_url.startswith('http://'):
            file_url = file_url.replace('http://', 'https://', 1)
        file_size = os.path.getsize(file_path) # size in bytes

        return jsonify({
            'message': 'File uploaded successfully',
            'file_id': file_id,
            'file_name': filename,
            'file_type': file.content_type,
            'file_size': file_size,
            'file_url': file_url
        }), 200
    return jsonify({'error': 'File type not allowed'}), 400

# Chunked upload endpoint for large files
@app.route('/upload_chunk', methods=['POST'])
def upload_chunk():
    try:
        # Get chunk data from request
        chunk_data = request.files.get('chunk')
        chunk_number = int(request.form.get('chunkNumber', 0))
        total_chunks = int(request.form.get('totalChunks', 1))
        file_id = request.form.get('fileId')
        filename = request.form.get('filename')
        
        if not all([chunk_data, file_id, filename]):
            return jsonify({'error': 'Missing required parameters'}), 400
            
        # Create temp directory for chunks if it doesn't exist
        temp_dir = os.path.join(app.config['UPLOAD_FOLDER'], 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        
        # Save chunk to temp file
        chunk_filename = f"{file_id}_chunk_{chunk_number}"
        chunk_path = os.path.join(temp_dir, chunk_filename)
        chunk_data.save(chunk_path)
        
        # If this is the last chunk, combine all chunks
        if chunk_number == total_chunks - 1:
            # Combine all chunks into final file
            secure_name = secure_filename(filename)
            file_extension = secure_name.rsplit('.', 1)[1].lower() if '.' in secure_name else ''
            unique_filename = f"{file_id}.{file_extension}"
            final_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            
            with open(final_path, 'wb') as final_file:
                for i in range(total_chunks):
                    chunk_file_path = os.path.join(temp_dir, f"{file_id}_chunk_{i}")
                    if os.path.exists(chunk_file_path):
                        with open(chunk_file_path, 'rb') as chunk_file:
                            final_file.write(chunk_file.read())
                        # Clean up chunk file
                        os.remove(chunk_file_path)
            
            # Get file info
            file_size = os.path.getsize(final_path)
            file_url = url_for('static', filename=f'uploads/{unique_filename}', _external=True)
            if file_url.startswith('http://'):
                file_url = file_url.replace('http://', 'https://', 1)
            
            # Get file type based on extension
            file_type = 'application/octet-stream'  # default
            if file_extension:
                import mimetypes
                file_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
            
            return jsonify({
                'message': 'File uploaded successfully',
                'file_id': file_id,
                'file_name': secure_name,
                'file_type': file_type,
                'file_size': file_size,
                'file_url': file_url,
                'completed': True
            }), 200
        else:
            # Chunk uploaded successfully, but not the last one
            return jsonify({
                'message': f'Chunk {chunk_number + 1}/{total_chunks} uploaded successfully',
                'completed': False
            }), 200
            
    except Exception as e:
        return jsonify({'error': f'Upload failed: {str(e)}'}), 500

@app.route('/download_file/<file_id>', methods=['GET'])
def download_file(file_id):
    try:
        # Find the file in the uploads directory
        upload_folder = app.config['UPLOAD_FOLDER']
        
        # Look for files that start with the file_id
        for filename in os.listdir(upload_folder):
            if filename.startswith(file_id + '.'):
                file_path = os.path.join(upload_folder, filename)
                if os.path.exists(file_path):
                    # Get the original filename from the database or use the current filename
                    # For now, we'll extract it from the filename pattern
                    original_name = filename
                    
                    # Send file with proper headers for download
                    return send_file(
                        file_path,
                        as_attachment=True,
                        download_name=original_name,
                        mimetype='application/octet-stream'
                    )
        
        return jsonify({'error': 'File not found'}), 404
        
    except Exception as e:
        return jsonify({'error': f'Download failed: {str(e)}'}), 500

@app.route('/get-ice-servers', methods=['GET'])
def get_ice_servers():
    url = f"https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate"
    headers = {
        "Authorization": f"Bearer {TURN_API_TOKEN}",
        "Content-Type": "application/json"
    }
    data = {"ttl": 86400}
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        turn_credentials = response.json()
        # Convert 'ice_servers' to 'iceServers' for WebRTC compatibility
        if 'ice_servers' in turn_credentials:
            turn_credentials['iceServers'] = turn_credentials['ice_servers']
            del turn_credentials['ice_servers']
        return jsonify(turn_credentials)
    except requests.exceptions.RequestException as e:
        print(f"Error generating TURN credentials: {e}")
        return jsonify({"error": "Failed to generate TURN credentials"}), 500

def get_public_ip_address():
    try:
        response = requests.get('https://api.ipify.org')
        return response.text
    except requests.RequestException:
        return None

# ==========================
#  USER MANAGEMENT
# ==========================
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    email = db.Column(db.String(120), unique=False)
    is_admin = db.Column(db.Boolean, default=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password, method='pbkdf2:sha256')

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

# Password Reset Token Model
class PasswordResetToken(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    email = db.Column(db.String(120), nullable=False)
    verification_code = db.Column(db.String(6), nullable=False)
    token = db.Column(db.String(100), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.datetime.now(datetime.timezone.utc))
    expires_at = db.Column(db.DateTime, nullable=False)
    is_used = db.Column(db.Boolean, default=False)
    attempts = db.Column(db.Integer, default=0)
    
    def __init__(self, user_id, email):
        self.user_id = user_id
        self.email = email
        self.verification_code = self.generate_verification_code()
        self.token = self.generate_token()
        self.created_at = datetime.datetime.now(datetime.timezone.utc)
        self.expires_at = self.created_at + datetime.timedelta(minutes=15)  # 15 minutes expiry
        
    def generate_verification_code(self):
        """Generate a 6-digit verification code"""
        return ''.join(secrets.choice(string.digits) for _ in range(6))
    
    def generate_token(self):
        """Generate a secure token for the reset process"""
        return secrets.token_urlsafe(32)
    
    def is_expired(self):
        """Check if the token has expired"""
        now = datetime.datetime.now(datetime.timezone.utc)
        # Handle timezone-naive expires_at from database
        if self.expires_at.tzinfo is None:
            expires_at_utc = self.expires_at.replace(tzinfo=datetime.timezone.utc)
        else:
            expires_at_utc = self.expires_at
        return now > expires_at_utc
    
    def is_valid(self):
        """Check if token is valid (not used, not expired, attempts < 3)"""
        return not self.is_used and not self.is_expired() and self.attempts < 3

# Email Service Functions
def validate_email_address(email):
    """Validate email address format"""
    try:
        valid = validate_email(email)
        return True, valid.email
    except EmailNotValidError:
        return False, None

def send_verification_email(email, verification_code, username):
    """Send verification code email"""
    try:
        print(f"🔧 DEBUG: Attempting to send email to {email}")
        print(f"🔧 DEBUG: SMTP Config - Server: {app.config.get('MAIL_SERVER')}, Port: {app.config.get('MAIL_PORT')}")
        print(f"🔧 DEBUG: Username: {app.config.get('MAIL_USERNAME')}")
        print(f"🔧 DEBUG: TLS: {app.config.get('MAIL_USE_TLS')}")
        
        msg = MailMessage(
            subject='Password Reset Verification Code - Flask Chat',
            recipients=[email],
            html=f'''
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
                    <h1 style="color: white; margin: 0; font-size: 28px;">🔐 Password Reset</h1>
                    <p style="color: #f0f0f0; margin: 10px 0 0 0; font-size: 16px;">Flask Chat App</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; margin-bottom: 20px;">
                    <h2 style="color: #333; margin-top: 0;">Hello {username}!</h2>
                    <p style="color: #666; font-size: 16px; line-height: 1.6;">
                        You requested a password reset for your Flask Chat account. Use the verification code below to proceed:
                    </p>
                    
                    <div style="background: white; border: 2px dashed #667eea; padding: 20px; margin: 25px 0; text-align: center; border-radius: 8px;">
                        <h1 style="color: #667eea; font-size: 36px; margin: 0; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                            {verification_code}
                        </h1>
                        <p style="color: #888; margin: 10px 0 0 0; font-size: 14px;">Verification Code</p>
                    </div>
                    
                    <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
                        <p style="margin: 0; color: #856404; font-size: 14px;">
                            <strong>⏰ Important:</strong> This code expires in 15 minutes and can only be used once.
                        </p>
                    </div>
                </div>
                
                <div style="background: #e9ecef; padding: 20px; border-radius: 8px; font-size: 14px; color: #6c757d;">
                    <p style="margin: 0 0 10px 0;"><strong>Security Tips:</strong></p>
                    <ul style="margin: 0; padding-left: 20px;">
                        <li>Never share this code with anyone</li>
                        <li>If you didn't request this reset, please ignore this email</li>
                        <li>Contact support if you have concerns about your account security</li>
                    </ul>
                </div>
                
                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                    <p style="color: #888; font-size: 12px; margin: 0;">
                        This email was sent by Flask Chat App<br>
                        If you have questions, please contact our support team.
                    </p>
                </div>
            </div>
            ''',
            body=f'''
Password Reset Verification Code

Hello {username}!

You requested a password reset for your Flask Chat account.

Your verification code is: {verification_code}

This code expires in 15 minutes and can only be used once.

If you didn't request this reset, please ignore this email.

Best regards,
Flask Chat Team
            '''
        )
        
        print(f"🔧 DEBUG: Sending email with verification code: {verification_code}")
        mail.send(msg)
        print(f"✅ DEBUG: Email sent successfully to {email}")
        return True, "Email sent successfully"
    except Exception as e:
        print(f"❌ Email sending error: {str(e)}")
        print(f"❌ Error type: {type(e).__name__}")
        import traceback
        print(f"❌ Full traceback: {traceback.format_exc()}")
        return False, f"Failed to send email: {str(e)}"

def cleanup_expired_tokens():
    """Clean up expired password reset tokens"""
    try:
        expired_tokens = PasswordResetToken.query.filter(
            PasswordResetToken.expires_at < datetime.datetime.now(datetime.timezone.utc)
        ).all()
        
        for token in expired_tokens:
            db.session.delete(token)
        
        db.session.commit()
        print(f"Cleaned up {len(expired_tokens)} expired tokens")
    except Exception as e:
        print(f"Token cleanup error: {str(e)}")
        db.session.rollback()

# Signup page (GET)
@app.route('/signup', methods=['GET'])
def signup_page():
    return render_template('signup.html')



@app.route('/admin', methods=['GET', 'POST'])
def admin_login():
    admin_username = os.environ.get('ADMIN_USERNAME', 'admin')
    admin_password = os.environ.get('ADMIN_PASSWORD', 'adminpass')
    error = None
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if username == admin_username and password == admin_password:
            session['is_admin'] = True
            session['admin_user'] = username
            return redirect(url_for('admin_dashboard'))
        else:
            error = 'Invalid credentials'
    return render_template('admin_login.html', error=error)

@app.route('/admin/dashboard')
def admin_dashboard():
    if not session.get('is_admin'):
        abort(403)
    users = User.query.all()
    return render_template('admin_dashboard.html', users=users)

@app.route('/admin/delete_all_messages', methods=['POST'])
def admin_delete_all_messages():
    if not session.get('is_admin'):
        return jsonify({'success': False, 'error': 'Not authorized'}), 403
    try:
        num_msgs = Message.query.delete()
        num_audio = 0
        try:
            num_audio = AudioMessage.query.delete()
        except Exception:
            pass  # If AudioMessage doesn't exist, ignore
        db.session.commit()
        # Emit to all clients to refresh messages
        socketio.emit('all_messages_deleted')
        return jsonify({'success': True, 'deleted_messages': num_msgs, 'deleted_audio_messages': num_audio})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/admin/toggle/<username>', methods=['POST'])
def admin_toggle(username):
    if not session.get('is_admin'):
        abort(403)
    user = User.query.filter_by(username=username).first()
    if not user:
        abort(404)
    user.is_admin = not user.is_admin
    db.session.commit()
    return redirect(url_for('admin_dashboard'))


# Signup route
@app.route('/signup', methods=['POST'])
def signup():
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')
    email = data.get('email', '').strip() or None
    is_admin = bool(data.get('is_admin', False))
    if not username or not password:
        return jsonify({'msg': 'Username and password are required'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'msg': 'Username already exists'}), 400
    user = User(username=username, email=email, is_admin=is_admin)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return jsonify({'msg': 'Signup successful'}), 200

# Login page (GET)
@app.route('/login')
def login():
    return render_template('login.html')

# Login route (POST)
@app.route('/login', methods=['POST'])
def login_post():
    username = request.json.get('username', None)
    password = request.json.get('password', None)
    if not username or not password:
        return jsonify({"msg": "Missing username or password"}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({"msg": "Username not found"}), 401
    if not user.check_password(password):
        return jsonify({"msg": "Wrong password"}), 401
    # --- Set session for admin status and username ---
    session['is_admin'] = user.is_admin
    session['username'] = user.username
    access_token = create_access_token(identity=username)
    active_tokens.add(access_token)
    
    # Return comprehensive user info for mobile auth
    return jsonify({
        "access_token": access_token,
        "user": {
            "username": user.username,
            "is_admin": user.is_admin,
            "email": user.email
        },
        "success": True
    })

# Password Reset page (GET)
@app.route('/reset-password', methods=['GET'])
def reset_password_page():
    return render_template('reset_password.html')

# Step 1: Request password reset (send verification code)
@app.route('/api/request-password-reset', methods=['POST'])
def request_password_reset():
    print(f"🔧 DEBUG: Password reset request received")
    cleanup_expired_tokens()  # Clean up old tokens
    
    data = request.get_json()
    print(f"🔧 DEBUG: Request data: {data}")
    username = data.get('username') if data else None
    email = data.get('email') if data else None
    print(f"🔧 DEBUG: Username: {username}, Email: {email}")
    
    if not username or not email:
        print(f"❌ DEBUG: Missing username or email")
        return jsonify({'error': 'Username and email are required'}), 400
    
    # Validate email format
    print(f"🔧 DEBUG: Validating email format...")
    is_valid, validated_email = validate_email_address(email)
    if not is_valid:
        print(f"❌ DEBUG: Invalid email format: {email}")
        return jsonify({'error': 'Invalid email format'}), 400
    print(f"✅ DEBUG: Email format valid: {validated_email}")
    
    # Find user
    print(f"🔧 DEBUG: Looking for user: {username}")
    user = User.query.filter_by(username=username).first()
    if not user:
        print(f"❌ DEBUG: User not found: {username}")
        return jsonify({'error': 'Username not found'}), 404
    print(f"✅ DEBUG: User found - ID: {user.id}, Email: {user.email}")
    
    # Check if email matches (if user has email set)
    if user.email and user.email.lower() != validated_email.lower():
        print(f"❌ DEBUG: Email mismatch - User email: {user.email}, Provided: {validated_email}")
        return jsonify({'error': 'Email does not match the account'}), 400
    print(f"✅ DEBUG: Email matches user account")
    
    # Rate limiting: Check for recent requests
    print(f"🔧 DEBUG: Checking for recent requests...")
    try:
        recent_token = PasswordResetToken.query.filter_by(
            user_id=user.id,
            email=validated_email
        ).filter(
            PasswordResetToken.created_at > datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=2)
        ).first()
        
        if recent_token:
            print(f"❌ DEBUG: Recent request found, rate limiting")
            return jsonify({'error': 'Please wait 2 minutes before requesting another code'}), 429
        print(f"✅ DEBUG: No recent requests, proceeding...")
    except Exception as e:
        print(f"❌ DEBUG: Database error during rate limiting check: {str(e)}")
        return jsonify({'error': 'Database error occurred'}), 500
    
    # Create new reset token
    reset_token = PasswordResetToken(user.id, validated_email)
    db.session.add(reset_token)
    
    try:
        db.session.commit()
        
        # Send verification email
        email_sent, email_message = send_verification_email(
            validated_email, 
            reset_token.verification_code, 
            user.username
        )
        
        if email_sent:
            return jsonify({
                'success': True,
                'message': 'Verification code sent to your email',
                'token': reset_token.token,
                'expires_in': 15  # minutes
            }), 200
        else:
            # Remove token if email failed
            db.session.delete(reset_token)
            db.session.commit()
            return jsonify({'error': f'Failed to send email: {email_message}'}), 500
            
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Database error occurred'}), 500

# Step 2: Verify code and reset password
@app.route('/api/verify-reset-code', methods=['POST'])
def verify_reset_code():
    data = request.get_json()
    token = data.get('token')
    verification_code = data.get('code')
    new_password = data.get('newPassword')
    
    if not token or not verification_code or not new_password:
        return jsonify({'error': 'Token, verification code, and new password are required'}), 400
    
    # Find reset token
    reset_token = PasswordResetToken.query.filter_by(token=token).first()
    if not reset_token:
        return jsonify({'error': 'Invalid or expired reset token'}), 400
    
    # Check if token is valid
    if not reset_token.is_valid():
        return jsonify({'error': 'Reset token has expired or been used'}), 400
    
    # Increment attempts
    reset_token.attempts += 1
    
    # Check verification code
    if reset_token.verification_code != verification_code:
        db.session.commit()  # Save attempt increment
        
        remaining_attempts = 3 - reset_token.attempts
        if remaining_attempts <= 0:
            return jsonify({'error': 'Too many failed attempts. Please request a new code.'}), 429
        
        return jsonify({
            'error': f'Invalid verification code. {remaining_attempts} attempts remaining.'
        }), 400
    
    # Get user and update password
    user = User.query.get(reset_token.user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Validate password strength
    if len(new_password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters long'}), 400
    
    try:
        # Update password
        user.set_password(new_password)
        
        # Mark token as used
        reset_token.is_used = True
        
        # Update user email if it wasn't set
        if not user.email:
            user.email = reset_token.email
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Password has been reset successfully. You can now log in with your new password.'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Failed to update password'}), 500

# Legacy endpoint for backward compatibility
@app.route('/reset-password', methods=['POST'])
def reset_password_legacy():
    return jsonify({
        'error': 'This endpoint is deprecated. Please use /api/request-password-reset and /api/verify-reset-code',
        'new_endpoints': {
            'step1': '/api/request-password-reset',
            'step2': '/api/verify-reset-code'
        }
    }), 410

# Logout route
@app.route('/logout')
@jwt_required()
def logout(current_user):
    token = request.headers.get('Authorization').split(' ')[1]
    active_tokens.remove(token)
    return jsonify({"msg": "Successfully logged out"})

# Token validation endpoint for mobile authentication
@app.route('/api/validate-token', methods=['POST'])
@jwt_required()
def validate_token():
    try:
        current_user = get_jwt_identity()
        user = User.query.filter_by(username=current_user).first()
        if user:
            # Get the token from the request header
            auth_header = request.headers.get('Authorization', '')
            if auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
                # Add the validated token back to active_tokens
                active_tokens.add(token)
                # Set session data for auto-login
                session['username'] = current_user
                session['is_admin'] = user.is_admin
                print(f"[VALIDATE_TOKEN] Token validated, session set, and added to active_tokens for user: {current_user}")
            
            return jsonify({
                "valid": True, 
                "user": current_user,
                "is_admin": user.is_admin
            }), 200
        else:
            return jsonify({"valid": False, "error": "User not found"}), 404
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)}), 401

# List all registered users (for lobby)
@app.route('/users', methods=['GET'])
def get_users():
    users = User.query.with_entities(User.username).all()
    return jsonify([u.username for u in users])



@app.route('/lobby')
def lobby():
    return render_template('lobby.html', is_admin=session.get('is_admin', False))

@app.route('/call')
def call():
    return render_template('call.html')

@app.route('/room/<room_id>')
def room(room_id):
    return render_template('room.html', room_id=room_id)


@app.errorhandler(NoAuthorizationError)
def handle_missing_auth(error):
    return render_template('login_required.html'), 401

@socketio.on('authenticate')
def on_authenticate(data):
    print("[AUTH_EVENT] 'authenticate' event received")
    token = data.get('token')
    print(f"[AUTH_EVENT] Token received: {token is not None}")
    if token and token in active_tokens:
        try:
            decoded_token = decode_token(token)
            print(f"[AUTH_EVENT] Token decoded successfully for identity: {decoded_token['sub']}")
            return True
        except Exception as e:
            print(f"[AUTH_EVENT] Token authentication failed: {e}")
            return False
    else:
        print("[AUTH_EVENT] Token not provided or not in active_tokens")
    return False

@socketio.on('register')
def on_register(data):
    print("\n[REGISTER_EVENT] 'register' event received")
    username = data.get('username')
    token = data.get('token')
    print(f"[REGISTER_EVENT] Username: {username}, Token provided: {token is not None}")

    if username and token:
        if token not in active_tokens:
            print("[REGISTER_EVENT] Token invalid or not in active_tokens. Active tokens: {}".format(len(active_tokens)))
            emit('force_logout', {'reason': 'invalid_token'}, room=request.sid)
            return False  # Return immediately after emitting 'force_logout'
        sid = request.sid
        # Remove any previous SID for this username (handle reconnects/restarts)
        to_remove = [s for s, u in online_users.items() if u == username and s != sid]
        for s in to_remove:
            print(f"[REGISTER_EVENT] Removing old SID {s} for username '{username}'")
            del online_users[s]
        print(f"[REGISTER_EVENT] Registering user '{username}' with SID '{sid}'")
        online_users[sid] = username
        print(f"[REGISTER_EVENT] Current online_users: {online_users}")
        
        # Update delivery status for messages when user comes online
        update_delivery_status_for_user(username)
        
        broadcast_user_list()
        return True
    else:
        print("[REGISTER_EVENT] Username not provided in data")
        return False

    try:
        # No code here, as the return statements above will exit the function
        pass
    except Exception as e:
        print(f"[REGISTER_EVENT] Token validation or registration error: {e}")
        return False

@socketio.on('connect')
def on_connect():
    print(f"[CONNECT] Client connected: {request.sid}")
    # Send the current user list to the newly connected client
    user_list = get_user_list_with_status()
    socketio.emit('user_list', user_list, room=request.sid)
    
    # Check if this is a user reconnecting and update delivery status
    for sid, username in online_users.items():
        if sid == request.sid:
            update_delivery_status_for_user(username)
            break

@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    if sid in online_users:
        del online_users[sid]
        broadcast_user_list()

def get_user_list_with_status():
    """Helper function to get all users with their online status."""
    all_users = User.query.all()
    online_usernames = set(online_users.values())
    
    user_list = []
    for user in all_users:
        user_list.append({
            'username': user.username,
            'online': user.username in online_usernames
        })
    return user_list

def broadcast_user_list():
    print("[BROADCAST] Broadcasting user list...")
    user_list = get_user_list_with_status()
    print(f"[BROADCAST] User list to emit: {user_list}")
    socketio.emit('user_list', user_list)
    print("[BROADCAST] 'user_list' event emitted.")

# --- Call signaling between users by username ---
@socketio.on('call_initiate')
def on_call_initiate(data):
    target_username = data.get('target')
    call_type = data.get('call_type')
    from_username = data.get('from')
    room_id = data.get('room') # Expecting room_id from client

    print(f"[CALL_INITIATE] Received from {from_username} to {target_username}. Type: {call_type}. Room: {room_id}")

    if not all([target_username, call_type, from_username, room_id]):
        print("[CALL_INITIATE] Error: Missing data (target, call_type, from, or room).")
        # Optionally, emit an error back to the initiator
        initiator_sid = next((s for s, u in online_users.items() if u == from_username), None)
        if initiator_sid:
            socketio.emit('call_error', {'message': 'Call initiation failed due to missing data.'}, room=initiator_sid)
        return

    target_sid = None
    for sid, uname in online_users.items():
        if uname == target_username:
            target_sid = sid
            break
    
    if target_sid:
        print(f"[CALL_INITIATE] Sending 'call_offer' to {target_username} (SID: {target_sid}) for room {room_id}")
        # Include room_id in the call_offer
        socketio.emit('call_offer', {
            'from': from_username, 
            'call_type': call_type, 
            'room_id': room_id  # Pass the room_id to the callee
        }, room=target_sid)
    else:
        print(f"[CALL_INITIATE] Error: Target user {target_username} not found or offline.")
        # Notify initiator that target is offline
        initiator_sid = next((s for s, u in online_users.items() if u == from_username), None)
        if initiator_sid:
            socketio.emit('call_error', {'message': f'User {target_username} is not online.'}, room=initiator_sid)

@socketio.on('call_response')
def on_call_response(data):
    to_username = data.get('to')          # Original caller
    from_username = data.get('from')      # Callee who is responding
    accepted = data.get('accepted')
    room_id = data.get('room_id')     # Expecting room_id from client's response
    call_type = data.get('call_type') # Expecting call_type from client's response

    print(f"[CALL_RESPONSE] Received from {from_username} to {to_username}. Accepted: {accepted}. Room: {room_id}. Type: {call_type}")

    if not all([to_username, from_username, room_id]) or accepted is None:
        print("[CALL_RESPONSE] Error: Missing data (to, from, room_id, or accepted status).")
        # Optionally, emit an error back to the responder (from_username)
        responder_sid = next((s for s, u in online_users.items() if u == from_username), None)
        if responder_sid:
            socketio.emit('call_error', {'message': 'Call response failed due to missing data.'}, room=responder_sid)
        return

    to_sid = None # SID of the original caller
    for sid, uname in online_users.items():
        if uname == to_username:
            to_sid = sid
            break
            
    if to_sid:
        print(f"[CALL_RESPONSE] Sending 'call_response' back to {to_username} (SID: {to_sid})")
        socketio.emit('call_response', {
            'from': from_username,      # The user who accepted/rejected
            'accepted': accepted,
            'room_id': room_id,         # Pass the room_id back
            'call_type': call_type      # Pass the call_type back for redirect
        }, room=to_sid)
    else:
        print(f"[CALL_RESPONSE] Error: Original caller {to_username} not found or offline.")

# --- WebRTC signaling using SocketIO ---

@socketio.on('join')
def on_join(data):
    room = data.get('room')
    username = data.get('username')
    join_room(room)
    print(f"[JOIN] {username} joined room {room}")
    # --- Reset unread count ---
    unread = UnreadMessage.query.filter_by(username=username, room=room).first()
    if unread:
        unread.count = 0
        db.session.commit()

    if room and username:
        # Extract peer from room name
        try:
            users = room.split('-')
            peer = [u for u in users if u != username][0] if len(users) == 2 else ''
        except Exception:
            peer = ''
        socketio.emit('room_joined', {'room_id': room, 'peer': peer}, room=request.sid)

@socketio.on('leave')
def on_leave(data):
    room = data.get('room')
    username = data.get('username')
    leave_room(room)
    print(f"[LEAVE] {username} left room {room}")



@socketio.on('signal')
def on_signal(data):
    room = data.get('room')
    signal_data = data.get('signal')
    sender = data.get('from')
    target = signal_data.get('target') if signal_data else None

    if not room or not signal_data or not sender:
        print(f"[SIGNAL ERROR] Malformed signal event: {data}")
        return

    if target:
        # Direct message to a specific peer
        target_sid = None
        for sid, uname in online_users.items():
            if uname == target:
                target_sid = sid
                break
        if target_sid:
            print(f"[SIGNAL] Direct to {target} (sid={target_sid}) from {sender}: {signal_data}")
            emit('signal', {'from': sender, 'signal': signal_data}, room=target_sid)
        else:
            print(f"[SIGNAL ERROR] Target user {target} not found online.")
    else:
        # Relay to everyone else in the room (normal WebRTC signaling)
        print(f"[SIGNAL] Relaying in room={room} from {sender}: {signal_data}")
        emit('signal', {'from': sender, 'signal': signal_data}, room=room, include_self=False)

@socketio.on('send_file')
def handle_send_file(data, sid=None):
    from flask_jwt_extended import decode_token
    from flask_jwt_extended.config import config
    token = data.get('token')
    if not token:
        print("No JWT token provided in send_file event")
        return
    try:
        decoded = decode_token(token, csrf_value=None, allow_expired=False)
        current_user = decoded.get(config.identity_claim_key, None)
        if not current_user:
            print("JWT token did not contain user identity")
            return
    except Exception as e:
        print(f"JWT verification failed: {e}")
        return
    room = data.get('room')
    file_id = data.get('file_id')
    file_name = data.get('file_name')
    file_type = data.get('file_type')
    file_size = data.get('file_size')
    file_url = data.get('file_url')

    if not all([room, file_id, file_name, file_type, file_size, file_url]):
        print("Missing file data for send_file event")
        return

    try:
        # Verify file exists
        file_ext = data.get('file_ext') or (file_name.split('.')[-1] if '.' in file_name else file_type.split('/')[-1])
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{file_id}.{file_ext}")
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            return

        # Create message in database
        new_message = Message(
            room=room,
            sender=current_user,
            content=None,  # Do not patch the file_name; content is None for file-only messages
            file_id=file_id,
            file_name=file_name,
            file_type=file_type,
            file_size=file_size,
            file_url=file_url,
            message_class='file_message'
        )
        db.session.add(new_message)
        db.session.commit()

        # Emit file message to all users in the room except the sender
        emit('file_message', {
            'sender': current_user,
            'room': room,
            'file_id': file_id,
            'file_name': file_name,
            'file_type': file_type,
            'file_size': file_size,
            'file_url': file_url,
            'timestamp': new_message.timestamp.isoformat(),
            'message_id': new_message.id
        }, room=room, include_self=False)

        print(f"File message sent: {file_name} to room {room}")

    except Exception as e:
        print(f"Error handling file message: {e}")
        db.session.rollback()
        return

@socketio.on('message')
@jwt_required()
def handle_message(data):
    current_user = get_jwt_identity()
    room = data.get('room')
    message_content = data.get('message')
    reply_to_message_id = data.get('reply_to_message_id')
    
    # Extract file data
    file_id = data.get('file_id')
    file_name = data.get('file_name')
    file_type = data.get('file_type')
    file_size = data.get('file_size')
    file_url = data.get('file_url')

    # Determine message class based on content type
    message_class = 'text_message'
    if file_id and file_url:
        message_class = 'file_message'
        if not message_content: # If no text message, provide a default for file
            message_content = f"[File] {file_name}"

    if not room or not (message_content or file_id): # Ensure there's content or a file
        print(f"[MESSAGE ERROR] Malformed message event: {data}")
        return

    new_message = Message(
        room=room,
        sender=current_user,
        content=message_content, # Use 'content' field for message text
        reply_to_message_id=reply_to_message_id,
        file_id=file_id,
        file_name=file_name,
        file_type=file_type,
        file_size=file_size,
        file_url=file_url,
        message_class=message_class,
        timestamp=datetime.datetime.now(datetime.timezone.utc) # Ensure timestamp is set
    )
    db.session.add(new_message)
    db.session.commit()

    emit('message', {
        'sender': current_user,
        'room': room,
        'message': message_content, # Use 'message' for the emitted content
        'timestamp': new_message.timestamp.isoformat(),
        'reply_to_message_id': reply_to_message_id,
        'file_id': file_id,
        'file_name': file_name,
        'file_type': file_type,
        'file_size': file_size,
        'file_url': file_url,
        'message_class': message_class,
        'message_id': new_message.id
    }, room=room)


@socketio.on('send_chat_message')
def on_send_chat_message(data):
    room = data.get('room')
    message = data.get('message')
    sender = data.get('from')
    reply_to_message_id = None
    reply_content = None
    reply_sender = None
    reply = data.get('reply')
    if reply:
        if 'message_id' in reply:
            try:
                reply_to_message_id = int(reply['message_id'])
            except Exception:
                reply_to_message_id = None
        reply_content = reply.get('message')
        reply_sender = reply.get('sender')
    if not room or not message or not sender:
        print(f"[CHAT ERROR] Malformed chat message event: {data}")
        return
    # Save to DB with initial 'sent' status
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    msg_obj = Message(room=room, sender=sender, message=message, timestamp=now_utc, 
                     reply_to_message_id=reply_to_message_id, reply_content=reply_content, 
                     reply_sender=reply_sender, status='sent')
    db.session.add(msg_obj)
    db.session.commit()
    
    print(f"[CHAT] Saved message in DB: {sender} -> {room} at {now_utc}")
    
    # Determine recipient(s) and check if they're online for delivery status
    room_participants = room.split('-')
    recipients = [p for p in room_participants if p != sender]
    
    delivered_to_recipients = []
    for recipient in recipients:
        recipient_sid = get_user_sid(recipient)
        if recipient_sid:
            delivered_to_recipients.append(recipient)
            # Update unread count for recipient
            unread = UnreadMessage.query.filter_by(username=recipient, room=room).first()
            if not unread:
                unread = UnreadMessage(username=recipient, room=room, count=1)
                db.session.add(unread)
            else:
                unread.count += 1
    
    # Update message status to 'delivered' if any recipient is online
    if delivered_to_recipients:
        msg_obj.status = 'delivered'
        db.session.commit()
        
        # Notify sender about delivery with recipient info
        sender_sid = get_user_sid(sender)
        if sender_sid:
            emit('message_delivered', {
                'message_id': msg_obj.id,
                'status': 'delivered',
                'delivered_to': delivered_to_recipients,
                'timestamp': now_utc.isoformat()+'Z'
            }, room=sender_sid)
    
    # Emit to room (existing behavior) with status
    emit('receive_chat_message', {
        'from': sender,
        'message': message,
        'timestamp': now_utc.isoformat()+'Z',
        'reply_to_message_id': reply_to_message_id,
        'reply_content': reply_content,
        'reply_sender': reply_sender,
        'message_id': msg_obj.id,
        'status': msg_obj.status,
        'delivered_to': delivered_to_recipients
    }, room=room, include_self=True)
    
    # Also emit global message notification to all online users (for contact list updates)
    # This allows users to see message previews even when they're in different rooms
    for sid, uname in online_users.items():
        if uname != sender:  # Don't send to sender
            emit('global_message_notification', {
                'from': sender,
                'message': message,
                'timestamp': now_utc.isoformat()+'Z',
                'room': room,
                'message_type': 'text'
            }, room=sid)


@socketio.on('mark_seen')
def mark_seen(data):
    """Mark messages as seen by the user"""
    message_ids = data.get('message_ids', [])
    current_user = data.get('current_user')
    sender = data.get('sender')
    room = data.get('room')
    
    if not message_ids or not current_user:
        print(f"[MARK_SEEN ERROR] Missing required data: {data}")
        return
    
    # Update message status to 'seen'
    updated_messages = []
    seen_timestamp = datetime.datetime.now(datetime.timezone.utc)
    
    for msg_id in message_ids:
        # Check regular messages
        msg = Message.query.get(msg_id)
        if msg and msg.sender != current_user and msg.status != 'seen':
            msg.status = 'seen'
            updated_messages.append({
                'id': msg.id,
                'type': 'text',
                'sender': msg.sender
            })
        
        # Check audio messages
        audio_msg = AudioMessage.query.get(msg_id)
        if audio_msg and audio_msg.sender != current_user and audio_msg.status != 'seen':
            audio_msg.status = 'seen'
            updated_messages.append({
                'id': audio_msg.id,
                'type': 'audio',
                'sender': audio_msg.sender
            })
    
    if updated_messages:
        db.session.commit()
        print(f"[MARK_SEEN] Marked {len(updated_messages)} messages as seen by {current_user}")
        
        # Group by sender to notify each sender
        senders_notified = set()
        for msg_info in updated_messages:
            sender = msg_info['sender']
            if sender not in senders_notified:
                sender_sid = get_user_sid(sender)
                if sender_sid:
                    # Get all message IDs for this sender
                    sender_msg_ids = [m['id'] for m in updated_messages if m['sender'] == sender]
                    emit('messages_seen', {
                        'message_ids': sender_msg_ids,
                        'seen_by': current_user,
                        'timestamp': seen_timestamp.isoformat()+'Z',
                        'room': room
                    }, room=sender_sid)
                senders_notified.add(sender)
        
        # Clear unread count for this room
        if room:
            unread = UnreadMessage.query.filter_by(username=current_user, room=room).first()
            if unread:
                unread.count = 0
                db.session.commit()


# --- Call Chat Message Handler ---
@socketio.on('call_chat_message')
def on_call_chat_message(data):
    room = data.get('room')
    message = data.get('message')
    sender = data.get('from')
    if not room or not message or not sender:
        print(f"[CALL_CHAT ERROR] Malformed call_chat_message event: {data}")
        return
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    msg_obj = Message(room=room, sender=sender, message=message, timestamp=now_utc)
    db.session.add(msg_obj)
    db.session.commit()
    print(f"[CALL_CHAT] Saved call chat message in DB: {sender} -> {room} at {now_utc}")
    # Emit to room (existing behavior)
    emit('call_chat_message', {'from': sender, 'message': message, 'timestamp': now_utc.isoformat()+'Z'}, room=room, include_self=False)
    
    # Also emit global message notification to all online users (for contact list updates)
    for sid, uname in online_users.items():
        if uname != sender:  # Don't send to sender
            emit('global_message_notification', {
                'from': sender,
                'message': message,
                'timestamp': now_utc.isoformat()+'Z',
                'room': room,
                'message_type': 'text'
            }, room=sid)

@app.route('/delete_message/<int:message_id>', methods=['DELETE'])
def delete_message(message_id):
    message = Message.query.get(message_id)
    username = request.args.get('username')
    if not message:
        return jsonify({"success": False, "error": "Message not found"}), 404
    if message.sender != username:
        return jsonify({"success": False, "error": "Not authorized"}), 403
    room = message.room or message.room_id
    db.session.delete(message)
    db.session.commit()
    # Broadcast deletion to all clients in the room
    if room:
        emit('chat_message_deleted', {'message_id': message_id}, room=room, namespace='/')
    return jsonify({"success": True, "message": "Message deleted", "id": message_id})
    

@app.route('/edit_message/<int:message_id>', methods=['PUT'])
def edit_message(message_id):
    data = request.get_json()
    new_content = data.get('content')
    message = Message.query.get(message_id)
    if message and new_content is not None:
        message.message = new_content
        db.session.commit()
        
        # Broadcast edit to all clients in the room
        room = message.room or message.room_id
        if room:
            emit('message_edited', {
                'messageId': message.id,
                'newContent': message.message,
                'timestamp': message.timestamp.isoformat() if message.timestamp else None
            }, room=room, namespace='/')
        
        return jsonify({
            "success": True,
            "message": "Message updated successfully",
            "data": {
                "id": message.id,
                "content": message.message,
                "timestamp": message.timestamp.isoformat() if message.timestamp else None
            }
        })
    else:
        return jsonify({
            "success": False,
            "error": "Message not found or invalid content",
            "data": None
        }), 404 

@socketio.on('live_typing')
def on_live_typing(data):
    room = data.get('room')
    sender = data.get('from')
    text = data.get('text', '')
    if not room or not sender:
        print(f"[LIVE_TYPING ERROR] Malformed live_typing event: {data}")
        return
    # Relay the live typing event to everyone else in the room
    emit('live_typing', {'from': sender, 'text': text}, room=room, include_self=False)

@socketio.on('call_chat_typing')
def on_call_chat_typing(data):
    room = data.get('room')
    sender = data.get('from')
    text = data.get('text', '')
    if not room or not sender:
        print(f"[CALL_CHAT_TYPING ERROR] Malformed call_chat_typing event: {data}")
        return
    # Relay the call chat typing event to everyone else in the room
    emit('call_chat_typing', {'from': sender, 'text': text}, room=room, include_self=False)

@socketio.on('call_chat_clear')
def on_call_chat_clear(data):
    room = data.get('room')
    sender = data.get('from')
    if not room or not sender:
        print(f"[CALL_CHAT_CLEAR ERROR] Malformed call_chat_clear event: {data}")
        return
    # Relay the clear event to everyone in the room
    emit('call_chat_clear', {'from': sender}, room=room, include_self=False)

@socketio.on('send_notification')
def on_send_notification(data):
    room = data.get('room')
    sender = data.get('from')
    if not room or not sender:
        print(f"[NOTIF ERROR] Malformed send_notification event: {data}")
        return
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    emit('receive_notification', {
        'from': sender,
        'room': room,
        'timestamp': now_utc.isoformat()+'Z'
    }, room=room, include_self=False)

@socketio.on('send_color')
def on_send_color(data):
    room = data.get('room')
    sender = data.get('from')
    color = data.get('color')
    if not room or not sender or not color:
        print(f"[COLOR ERROR] Malformed send_color event: {data}")
        return
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    emit('receive_color', {
        'from': sender,
        'room': room,
        'color': color,
        'timestamp': now_utc.isoformat()+'Z'
    }, room=room, include_self=False)

@socketio.on('reset_bg_color')
def on_reset_bg_color(data):
    room = data.get('room')
    sender = data.get('from')
    if not room or not sender:
        print(f"[RESET_BG_COLOR ERROR] Malformed reset_bg_color event: {data}")
        return
    import datetime
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    # Relay to everyone else in the room (not sender)
    emit('receive_reset_bg_color', {
        'from': sender,
        'room': room,
        'timestamp': now_utc.isoformat()+'Z'
    }, room=room, include_self=False)


@app.errorhandler(404)
def page_not_found(e):
    # Redirect to login page for non-existent routes
    return redirect(url_for('login'))



@app.route('/react_message', methods=['POST'])
def react_message():
    data = request.get_json()
    message_id = data.get('message_id')
    emoji = data.get('emoji')
    username = session.get('username') or request.json.get('username')
    if not message_id or not emoji or not username:
        return jsonify({'success': False, 'error': 'Missing data'}), 400
    
    # Check if this is an audio message reaction by looking in AudioMessage table first
    audio_msg = AudioMessage.query.get(message_id)
    
    msg = None
    if not audio_msg:
        msg = Message.query.get(message_id)
        if not msg:
            return jsonify({'success': False, 'error': 'Message not found'}), 404
    
    # Handle reactions for either message type (prioritize audio messages)
    if audio_msg:
        reactions = audio_msg.get_reactions()
        reactions[username] = emoji
        audio_msg.set_reactions(reactions)
        room = audio_msg.room
    else:
        reactions = msg.get_reactions()
        reactions[username] = emoji
        msg.set_reactions(reactions)
        room = msg.room or msg.room_id
    
    db.session.commit()

    # Emit socket event to update all clients in the room
    if room:
        from flask_socketio import emit
        socketio.emit('message_reactions_updated', {
            'message_id': message_id,
            'reactions': reactions,
        }, room=room)

    return jsonify({'success': True, 'reactions': reactions})

@app.route('/remove_reaction', methods=['POST'])
def remove_reaction():
    data = request.get_json()
    message_id = data.get('message_id')
    username = data.get('username') # Follows insecure pattern from react_message

    if not message_id or not username:
        return jsonify({'success': False, 'error': 'Missing data'}), 400

    # Try to find the message in both Message and AudioMessage tables
    msg = Message.query.get(message_id)
    audio_msg = None
    if not msg:
        audio_msg = AudioMessage.query.get(message_id)
        if not audio_msg:
            return jsonify({'success': False, 'error': 'Message not found'}), 404

    # Handle reaction removal for either message type
    if msg:
        reactions = msg.get_reactions()
        if username in reactions:
            del reactions[username]
            msg.set_reactions(reactions)
            room = msg.room or msg.room_id
    else:
        reactions = audio_msg.get_reactions()
        if username in reactions:
            del reactions[username]
            audio_msg.set_reactions(reactions)
            room = audio_msg.room
    
    db.session.commit()

    # Emit socket event to update all clients in the room
    if room:
        socketio.emit('message_reactions_updated', {
            'message_id': message_id,
            'reactions': reactions,
        }, room=room)

    return jsonify({'success': True, 'reactions': reactions})



@app.route('/messages/<room_id>', methods=['GET'])
@jwt_required()
def get_room_messages(room_id):
    # Fetch text/file messages
    messages = Message.query.filter(
        (Message.room == room_id) | (Message.room_id == room_id)
    ).order_by(Message.timestamp.asc()).all()
    # Fetch audio messages
    audio_messages = AudioMessage.query.filter_by(room=room_id).order_by(AudioMessage.timestamp.asc()).all()

    unified_messages = []
    # Add text/file messages
    for msg in messages:
        unified_messages.append({
            'type': 'text',
            'message_id': msg.id,
            'sender': msg.sender,
            'content': msg.content if msg.content else msg.message,
            'timestamp': msg.timestamp.isoformat() if msg.timestamp else None,
            'file_id': msg.file_id,
            'file_name': msg.file_name,
            'file_type': msg.file_type,
            'file_url': msg.file_url,
            'file_size': msg.file_size,
            'reply_to_message_id': msg.reply_to_message_id,
            'message_class': msg.message_class,
            'reactions': msg.get_reactions(),
            'reply_content': msg.reply_content,
            'reply_sender': msg.reply_sender,
            'status': msg.status or 'sent'
        })
    # Add audio messages
    for audio in audio_messages:
        unified_messages.append({
            'type': 'audio',
            'message_id': audio.id,  # Use audio.id as message_id for reactions
            'audio_id': audio.id,
            'sender': audio.sender,
            'audio_data': audio.audio_data,  # base64 string
            'timestamp': audio.timestamp.isoformat() if audio.timestamp else None,
            'room': audio.room,
            'reactions': audio.get_reactions(),  # Include reactions for audio messages
            'status': audio.status or 'sent'
        })
    # Sort all messages by timestamp
    unified_messages.sort(key=lambda m: m['timestamp'] or '')
    return jsonify(unified_messages)


@app.route('/latest_messages', methods=['GET'])
@jwt_required()
def get_latest_messages():
    """Get the latest message for each conversation room involving the current user"""
    current_user = get_jwt_identity()
    
    # Get all users to determine possible room combinations
    all_users = User.query.all()
    user_list = [user.username for user in all_users if user.username != current_user]
    
    latest_messages = {}
    
    for other_user in user_list:
        # Create room ID using sorted usernames (consistent with frontend logic)
        room_participants = sorted([current_user, other_user])
        room_id = f"{room_participants[0]}-{room_participants[1]}"
        
        # Find the latest incoming text/file message for this room (not from current user)
        latest_text_msg = Message.query.filter(
            ((Message.room == room_id) | (Message.room_id == room_id)) &
            (Message.sender != current_user)
        ).order_by(Message.timestamp.desc()).first()
        
        # Find the latest incoming audio message for this room (not from current user)
        latest_audio_msg = AudioMessage.query.filter(
            (AudioMessage.room == room_id) &
            (AudioMessage.sender != current_user)
        ).order_by(AudioMessage.timestamp.desc()).first()
        
        # Determine which message is actually the latest
        latest_msg = None
        msg_type = None
        
        if latest_text_msg and latest_audio_msg:
            # Compare timestamps to find the most recent
            if latest_text_msg.timestamp > latest_audio_msg.timestamp:
                latest_msg = latest_text_msg
                msg_type = 'text'
            else:
                latest_msg = latest_audio_msg
                msg_type = 'audio'
        elif latest_text_msg:
            latest_msg = latest_text_msg
            msg_type = 'text'
        elif latest_audio_msg:
            latest_msg = latest_audio_msg
            msg_type = 'audio'
        
        # Add to results if we found an incoming message
        if latest_msg:
            if msg_type == 'text':
                content = latest_msg.content if latest_msg.content else latest_msg.message
                # Handle file messages
                if latest_msg.file_name:
                    content = f"📎 {latest_msg.file_name}"
                elif not content:
                    content = "Message"
            else:  # audio message
                content = "🎵 Voice message"
            
            latest_messages[room_id] = {
                'message': content,
                'timestamp': latest_msg.timestamp.isoformat() if latest_msg.timestamp else None,
                'sender': latest_msg.sender,
                'type': msg_type
            }
    
    return jsonify(latest_messages)


# --- Translation Routes ---

@app.route('/detect_language', methods=['POST'])
def detect_language():
    """Detect the language of a given text"""
    data = request.get_json()
    text = data.get('text', '')
    if not text:
        return jsonify({'success': False, 'error': 'No text provided'}), 400
    
    try:
        # Use Google Translate API to detect language
        url = 'https://translate.googleapis.com/translate_a/single'
        params = {
            'client': 'gtx',
            'sl': 'auto',
            'tl': 'en',
            'dt': 't',
            'q': text
        }
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            result = resp.json()
            # Extract detected language from response
            detected_lang = result[2] if len(result) > 2 else 'en'
            is_english = detected_lang == 'en'
            return jsonify({
                'success': True, 
                'language': detected_lang,
                'is_english': is_english
            })
        else:
            return jsonify({'success': False, 'error': 'Language detection failed'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/translate_message', methods=['POST'])
def translate_message():
    data = request.get_json()
    text = data.get('text', '')
    target_lang = data.get('target_lang', 'en')  # Default to English
    if not text:
        return jsonify({'success': False, 'error': 'No text provided'}), 400
    try:
        # Use the unofficial Google Translate endpoint
        url = 'https://translate.googleapis.com/translate_a/single'
        params = {
            'client': 'gtx',
            'sl': 'auto',
            'tl': target_lang,
            'dt': 't',
            'q': text
        }
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            result = resp.json()
            # The translation is in result[0][0][0]
            translation = result[0][0][0]
            detected_lang = result[2] if len(result) > 2 else 'unknown'
            return jsonify({
                'success': True, 
                'translation': translation,
                'detected_language': detected_lang
            })
        else:
            return jsonify({'success': False, 'error': 'Translation API error'}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# Endpoint to get unread counts for the current user
@app.route('/api/unread-counts')
@jwt_required()
def get_unread_counts():
    current_user = get_jwt_identity()
    unread_messages = UnreadMessage.query.filter_by(username=current_user).all()
    return jsonify({room.room: room.count for room in unread_messages})

# Endpoint to get message status for specific messages
@app.route('/api/message-status', methods=['POST'])
@jwt_required()
def get_message_status():
    current_user = get_jwt_identity()
    data = request.get_json()
    message_ids = data.get('message_ids', [])
    
    if not message_ids:
        return jsonify({'error': 'No message IDs provided'}), 400
    
    status_info = []
    
    # Check regular messages
    messages = Message.query.filter(Message.id.in_(message_ids)).all()
    for msg in messages:
        if msg.sender == current_user:  # Only show status for user's own messages
            status_info.append({
                'message_id': msg.id,
                'status': msg.status,
                'type': 'text',
                'timestamp': msg.timestamp.isoformat() + 'Z'
            })
    
    # Check audio messages
    audio_messages = AudioMessage.query.filter(AudioMessage.id.in_(message_ids)).all()
    for msg in audio_messages:
        if msg.sender == current_user:  # Only show status for user's own messages
            status_info.append({
                'message_id': msg.id,
                'status': msg.status,
                'type': 'audio',
                'timestamp': msg.timestamp.isoformat() + 'Z'
            })
    
    return jsonify({'messages': status_info})

@app.route('/api/unread-counts', methods=['GET'])
@jwt_required()
def api_get_unread_counts():
    """Get unread message counts for all contacts"""
    try:
        current_user = get_jwt_identity()
        
        # Get all rooms where current user is involved
        all_rooms = db.session.query(Message.room).distinct().all()
        unread_counts = {}
        
        for (room,) in all_rooms:
            if current_user in room.split('-'):
                # Get the other user in the room
                users_in_room = room.split('-')
                other_user = None
                for user in users_in_room:
                    if user != current_user:
                        other_user = user
                        break
                
                if other_user:
                    # Count unread messages from the other user
                    unread_count = Message.query.filter_by(
                        room=room, 
                        sender=other_user
                    ).filter(
                        Message.status != 'seen'
                    ).count()
                    
                    # Also count unread audio messages
                    unread_audio_count = AudioMessage.query.filter_by(
                        room=room,
                        sender=other_user
                    ).filter(
                        AudioMessage.status != 'seen'
                    ).count()
                    
                    total_unread = unread_count + unread_audio_count
                    if total_unread > 0:
                        unread_counts[other_user] = total_unread
        
        return jsonify({'unread_counts': unread_counts})
        
    except Exception as e:
        print(f"Error getting unread counts: {e}")
        return jsonify({'error': 'Failed to get unread counts', 'unread_counts': {}}), 500

# Helper function to update message delivery status when user comes online
def update_delivery_status_for_user(username):
    """Update delivery status for messages when a user comes online"""
    # Find all 'sent' messages where this user is a recipient
    all_rooms = db.session.query(Message.room).distinct().all()
    
    updated_messages = []
    for (room,) in all_rooms:
        if username in room.split('-'):
            # Get all 'sent' messages in this room where user is not the sender
            sent_messages = Message.query.filter_by(room=room, status='sent').filter(Message.sender != username).all()
            sent_audio_messages = AudioMessage.query.filter_by(room=room, status='sent').filter(AudioMessage.sender != username).all()
            
            # Update to delivered
            for msg in sent_messages:
                msg.status = 'delivered'
                updated_messages.append({
                    'id': msg.id,
                    'sender': msg.sender,
                    'type': 'text'
                })
            
            for msg in sent_audio_messages:
                msg.status = 'delivered'
                updated_messages.append({
                    'id': msg.id,
                    'sender': msg.sender,
                    'type': 'audio'
                })
    
    if updated_messages:
        db.session.commit()
        
        # Notify senders about delivery
        senders_notified = set()
        for msg_info in updated_messages:
            sender = msg_info['sender']
            if sender not in senders_notified:
                sender_sid = get_user_sid(sender)
                if sender_sid:
                    sender_msg_ids = [m['id'] for m in updated_messages if m['sender'] == sender]
                    emit('messages_delivered', {
                        'message_ids': sender_msg_ids,
                        'delivered_to': username,
                        'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat()+'Z'
                    }, room=sender_sid)
                senders_notified.add(sender)
        
        print(f"[DELIVERY] Updated {len(updated_messages)} messages to delivered for user {username}")

import base64

@socketio.on('call_ended')
def on_call_ended(data):
    """
    Handle call ended event and relay to the room.
    Expects: {
        'room': str,
        'from': str,
        'duration': str,
        'callType': str
    }
    """
    room = data.get('room')
    sender = data.get('from')
    duration = data.get('duration')
    call_type = data.get('callType')
    
    if room and sender:
        # Relay the call_ended event to everyone in the room except sender
        emit('call_ended', {
            'from': sender,
            'duration': duration,
            'callType': call_type
        }, room=room, include_self=False)

@socketio.on('decline_call')
def on_decline_call(data):
    """
    Handle call decline event and relay to the room.
    Expects: {
        'room': str,
        'from': str
    }
    """
    room = data.get('room')
    sender = data.get('from')
    
    if room and sender:
        # Relay the call_declined event to everyone in the room except sender
        emit('call_declined', {
            'from': sender
        }, room=room, include_self=False)

@socketio.on('audio_message')
def on_audio_message(data):
    """
    Handle incoming audio messages. Persist and broadcast to the room.
    Expects: {
        'room': str,
        'from': str,
        'blob': binary (audio/webm) or base64/data URL,
        'timestamp': int (optional)
    }
    """
    room = data.get('room')
    sender = data.get('from')
    blob = data.get('blob')
    timestamp = data.get('timestamp')
    if not timestamp:
        timestamp = int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    # Convert blob to base64 string if not already
    if isinstance(blob, bytes):
        b64audio = base64.b64encode(blob).decode('utf-8')
    elif isinstance(blob, str) and blob.startswith('data:audio/webm;base64,'):
        b64audio = blob.split(',', 1)[1]
    else:
        # Assume it's a base64 string
        b64audio = blob
    # Persist audio message with initial 'sent' status
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    audio_msg = AudioMessage(
        room=room,
        sender=sender,
        audio_data=b64audio,
        timestamp=now_utc,
        status='sent'
    )
    db.session.add(audio_msg)
    db.session.commit()
    
    # Check delivery status for audio messages
    room_participants = room.split('-')
    recipients = [p for p in room_participants if p != sender]
    
    delivered_to_recipients = []
    for recipient in recipients:
        recipient_sid = get_user_sid(recipient)
        if recipient_sid:
            delivered_to_recipients.append(recipient)
            # Update unread count for recipient
            unread = UnreadMessage.query.filter_by(username=recipient, room=room).first()
            if not unread:
                unread = UnreadMessage(username=recipient, room=room, count=1)
                db.session.add(unread)
            else:
                unread.count += 1
    
    # Update audio message status to 'delivered' if any recipient is online
    if delivered_to_recipients:
        audio_msg.status = 'delivered'
        db.session.commit()
        
        # Notify sender about delivery
        sender_sid = get_user_sid(sender)
        if sender_sid:
            emit('message_delivered', {
                'message_id': audio_msg.id,
                'status': 'delivered',
                'delivered_to': delivered_to_recipients,
                'timestamp': now_utc.isoformat()+'Z',
                'type': 'audio'
            }, room=sender_sid)
    
    # Broadcast as data URL with status
    audio_url = f"data:audio/webm;base64,{b64audio}"
    emit('audio_message', {
        'from': sender,
        'blob': audio_url,
        'timestamp': timestamp,
        'message_id': audio_msg.id,
        'status': audio_msg.status,
        'delivered_to': delivered_to_recipients
    }, room=room, include_self=True)


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=7000, debug=True)
