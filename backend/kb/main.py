from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kb.api.ingest import router as ingest_router
from kb.api.wiki import router as wiki_router
from kb.api.chat import router as chat_router
from kb.api.lint import router as lint_router
from kb.auth.middleware import AuthMiddleware
from kb.auth.routes import router as auth_router
from kb.config import settings
from kb.errors import install_error_handlers
from kb.logging import setup_logging
from kb.middleware import RequestContextMiddleware


def create_app() -> FastAPI:
    setup_logging(level=settings.log_level)

    app = FastAPI(title="Knowledge Base API")

    # Middleware: added innermost-first, runs outermost-first on requests.
    # Order on the wire: CORS → RequestContext → Auth → routes.
    app.add_middleware(AuthMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    install_error_handlers(app)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(ingest_router)
    app.include_router(wiki_router)
    app.include_router(chat_router)
    app.include_router(lint_router)
    return app


app = create_app()
