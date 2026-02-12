FROM node:20-alpine

ARG VITE_GOOGLE_CLIENT_ID
ARG ALLOWED_HOSTS
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ENV ALLOWED_HOSTS=${ALLOWED_HOSTS:-localhost,127.0.0.1}

WORKDIR /app

COPY package*.json .npmrc* ./

RUN npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
