import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(__import__("os").getenv("PV_PORT", "8000")), log_level="info")