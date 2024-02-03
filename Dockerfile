FROM golang:1.21-alpine as base

# Load build arg
ARG APP_HOME

# Create development stage and set app location in container to /app
FROM base as development
WORKDIR $APP_HOME

# Add bash shell and gcc toolkit
RUN apk add --no-cache --upgrade bash build-base

# Install air
RUN go install github.com/cosmtrek/air@latest

# Copy go.mod and install go dependencies
COPY go.mod ./
RUN go mod download

# Copy source files
COPY . .

# Build and run binary with live reloading
CMD ["air"]