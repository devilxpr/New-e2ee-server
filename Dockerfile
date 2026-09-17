FROM mcr.microsoft.com/playwright:v1.50.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 10000

CMD ["node", "index.js"]
