import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Expects DATABASE_URL from docker-compose, otherwise fallback to sqlite for local testing
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sql_app.db")

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
