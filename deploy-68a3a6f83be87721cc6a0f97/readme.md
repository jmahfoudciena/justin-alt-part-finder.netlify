# Part Analysis Tool - Company Server Setup

This application helps engineers find alternative electronic components and compare parts using AI. It's designed to run as a web server accessible from your company's network.

## Quick Start

### 1. Install Node.js
- Download and install Node.js from [https://nodejs.org/](https://nodejs.org/)
- Choose the LTS version for stability
- Verify installation: `node --version` and `npm --version`

### 2. Configure Environment
1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and add your OpenAI API key:
   ```
   OPENAI_API_KEY=sk-your-actual-api-key-here
   ```

### 3. Start the Server

**On Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

**On Windows:**
```cmd
start.bat
```

**Manual start:**
```bash
npm install
npm start
```

### 4. Access from Company Network

Once the server is running, your company can access it at:
```
http://YOUR_VM_IP:3000
```

Replace `YOUR_VM_IP` with your actual virtual machine's IP address.

## Features

### Part Alternative Finder
- Enter a part number to find AI-powered alternatives
- Server-side processing for security
- Package and footprint compatibility analysis
- Detailed specifications and manufacturer information

### Part Comparator
- Compare any two parts side-by-side
- Electrical specifications comparison
- Register/firmware compatibility analysis
- Professional pinout diagrams with ASCII art
- Pinout and package analysis
- Drop-in compatibility assessment
- Export options (print/copy)

## Configuration

### API Key Setup
1. Get your OpenAI API key from [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a `.env` file from `.env.example`
3. Set your API key in the `.env` file

### Port Configuration
The server runs on port 3000 by default. To change this:
- Set the `PORT` environment variable in `.env`, or
- Edit `server.js` and change the port number

## Security Features

- **Server-side API calls**: All OpenAI API calls happen server-side
- **Environment variables**: API keys stored securely in `.env` file
- **CORS enabled**: For company network access
- **Helmet.js**: Security headers
- **Content Security Policy**: Configured for safety
- **Input sanitization**: XSS protection

## Network Configuration

### Firewall Setup
Make sure your VM's firewall allows incoming connections on port 3000:

**Ubuntu/Debian:**
```bash
sudo ufw allow 3000
```

**CentOS/RHEL:**
```bash
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

**Windows:**
- Open Windows Defender Firewall
- Add inbound rule for port 3000

### Finding Your VM's IP Address

**Linux/Mac:**
```bash
ip addr show
# or
hostname -I
```

**Windows:**
```cmd
ipconfig
```

## Troubleshooting

### Port Already in Use
If port 3000 is busy, change the port in `.env` or `server.js`.

### API Key Issues
- Ensure `.env` file exists and contains `OPENAI_API_KEY`
- Verify your API key is valid and has sufficient credits
- Check server console for error messages

### Firewall Issues
Make sure your VM's firewall allows incoming connections on port 3000.

### Network Access
Ensure your VM is accessible from your company's network and the IP address is correct.

### Permission Denied
On Linux/Mac, make sure the startup script is executable:
```bash
chmod +x start.sh
```

## Stopping the Server

Press `Ctrl+C` in the terminal where the server is running.

## Production Deployment

For production use, consider:

1. **Process Manager**: Use PM2 to keep the server running
   ```bash
   npm install -g pm2
   pm2 start server.js --name "part-analysis"
   pm2 startup
   pm2 save
   ```

2. **Reverse Proxy**: Use Nginx or Apache as a reverse proxy

3. **SSL**: Add HTTPS with Let's Encrypt

4. **Environment Variables**: Store API keys in environment variables (already implemented)

## Support

For issues or questions:
1. Check the console output for error messages
2. Verify your OpenAI API key is correct in `.env`
3. Ensure port 3000 is not blocked by firewall
4. Check that your VM's IP is accessible from the company network

## File Structure

```
├── index.html          # Main application page (unified interface)
├── styles.css          # Application styling
├── script.js           # Client-side logic (unified functionality)
├── server.js           # Express server with all API endpoints
├── package.json        # Node.js dependencies
├── .env.example        # Environment configuration template
├── start.sh            # Linux/Mac startup script
├── start.bat           # Windows startup script
└── README.md           # This file
```

## API Endpoints

- `POST /api/alternatives` - Find part alternatives
- `POST /api/compare` - Compare two parts
- `GET /health` - Server health check

## Usage

1. **Find Alternatives**: Enter a part number in the top section to find alternatives
2. **Compare Parts**: Enter two different part numbers in the bottom section to compare them
3. **Export Results**: Use print or copy options for comparison results
4. **Professional Analysis**: Get detailed pinout diagrams, specifications, and compatibility assessments
