import os

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-at-least-32-characters")
os.environ.setdefault("DATABASE_URL", "postgresql://unused")
os.environ.setdefault("UPLOAD_DIR", "/tmp/calldosgames-test-uploads")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")
