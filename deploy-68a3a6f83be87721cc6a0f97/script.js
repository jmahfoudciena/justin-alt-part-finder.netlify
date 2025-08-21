class PartAnalysisTool {
	constructor() {
		// Part alternatives elements
		this.partInput = document.getElementById('partInput');
		this.searchBtn = document.getElementById('searchBtn');
		this.results = document.getElementById('results');
		this.spinner = document.getElementById('spinner');
		
		// Part comparison elements
		this.partAInput = document.getElementById('partAInput');
		this.partBInput = document.getElementById('partBInput');
		this.compareBtn = document.getElementById('compareBtn');
		this.compareSpinner = document.getElementById('compareSpinner');
		this.compareResults = document.getElementById('compareResults');
		
		this.bindEvents();
	}
	
	bindEvents() {
		// Part alternatives events
		this.searchBtn.addEventListener('click', () => this.handleSearch());
		this.partInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				this.handleSearch();
			}
		});
		
		// Part comparison events
		this.compareBtn.addEventListener('click', () => this.handleCompare());
		[this.partAInput, this.partBInput].forEach(input => {
			input.addEventListener('keypress', (e) => {
				if (e.key === 'Enter') {
					this.handleCompare();
				}
			});
		});
	}
	
	// Part Alternatives Handler
	async handleSearch() {
		const partNumber = this.partInput.value.trim();
		
		if (!partNumber) {
			this.showError('Please enter a part number', 'results');
			return;
		}
		
		this.setLoading(true, 'search');
		
		try {
			const alternatives = await this.findAlternatives(partNumber);
			this.displayResults(alternatives, partNumber);
			
		} catch (error) {
			console.error('Error finding alternatives:', error);
			this.showError(`Failed to find alternatives: ${error.message}`, 'results');
		} finally {
			this.setLoading(false, 'search');
		}
	}
	
	// Part Comparison Handler
	async handleCompare() {
		const partA = this.partAInput.value.trim();
		const partB = this.partBInput.value.trim();
		
		if (!partA || !partB) {
			this.showError('Please enter both Part A and Part B.', 'compare');
			return;
		}
		
		if (partA.toLowerCase() === partB.toLowerCase()) {
			this.showError('Please enter two different parts for comparison.', 'compare');
			return;
		}
		
		this.setLoading(true, 'compare');
		
		try {
			const response = await this.callNetlifyFunction('/api/compare', { partA, partB });
			
			if (!response || !response.html) {
				throw new Error('Unexpected response from server');
			}
			
			this.displayComparisonResults(response.html, partA, partB);
		} catch (error) {
			this.showError(`Failed to compare parts: ${error.message}`, 'compare');
		} finally {
			this.setLoading(false, 'compare');
		}
	}
	
	// Enhanced API Calls for Netlify
	async findAlternatives(partNumber) {
		const response = await this.callNetlifyFunction('/api/alternatives', { partNumber });
		return response.alternatives;
	}
	
	async callNetlifyFunction(endpoint, data) {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json'
			},
			body: JSON.stringify(data)
		});
		
		console.log('Response status:', response.status);
		console.log('Response headers:', Object.fromEntries(response.headers));
		
		// Check if response is ok
		if (!response.ok) {
			let errorMessage = `HTTP ${response.status}`;
			try {
				const errorData = await response.text();
				console.log('Error response body:', errorData);
				
				// Try to parse as JSON
				try {
					const jsonError = JSON.parse(errorData);
					errorMessage = jsonError.error || errorMessage;
				} catch {
					// If not JSON, check if it's HTML (likely a 404 page)
					if (errorData.includes('<!DOCTYPE') || errorData.includes('<html>')) {
						errorMessage = 'Function not found - check Netlify deployment';
					} else {
						errorMessage = errorData.substring(0, 200); // First 200 chars
					}
				}
			} catch (readError) {
				console.error('Failed to read error response:', readError);
			}
			throw new Error(errorMessage);
		}
		
		// Get response text first
		const responseText = await response.text();
		console.log('Response body (first 200 chars):', responseText.substring(0, 200));
		
		// Try to parse as JSON
		try {
			return JSON.parse(responseText);
		} catch (parseError) {
			console.error('JSON Parse Error:', parseError);
			console.error('Response text:', responseText);
			
			if (responseText.includes('<!DOCTYPE') || responseText.includes('<html>')) {
				throw new Error('Received HTML instead of JSON - Netlify function not deployed correctly');
			} else {
				throw new Error(`Invalid JSON response: ${parseError.message}`);
			}
		}
	}
	
	// Loading States
	setLoading(loading, type) {
		if (type === 'search') {
			this.searchBtn.disabled = loading;
			this.spinner.style.display = loading ? 'block' : 'none';
			
			const buttonSpan = this.searchBtn.querySelector('span');
			if (buttonSpan) {
				buttonSpan.textContent = loading ? 'Searching...' : 'Find Alternatives';
			}
			
			if (loading) {
				this.results.classList.add('loading');
				this.results.innerHTML = '<div class="placeholder"><div class="placeholder-icon">🤖</div><p>AI is finding alternatives...</p></div>';
			} else {
				this.results.classList.remove('loading');
			}
		} else if (type === 'compare') {
			this.compareBtn.disabled = loading;
			this.compareSpinner.style.display = loading ? 'block' : 'none';
			
			const buttonSpan = this.compareBtn.querySelector('span');
			if (buttonSpan) {
				buttonSpan.textContent = loading ? 'Comparing...' : 'Compare Parts';
			}
			
			if (loading) {
				this.compareResults.classList.add('loading');
				this.compareResults.innerHTML = '<div class="placeholder"><div class="placeholder-icon">🤖</div><p>AI is building a comprehensive comparison...</p></div>';
			} else {
				this.compareResults.classList.remove('loading');
			}
		}
	}
	
	// Display Results
	displayResults(alternatives, originalPart) {
		this.results.innerHTML = '';
		
		// Create header for the original part
		const headerDiv = document.createElement('div');
		headerDiv.className = 'result-item header';
		headerDiv.innerHTML = `
			<div class="result-key">🔍 Original Part</div>
			<div class="result-value">${this.escapeHtml(originalPart)}</div>
		`;
		this.results.appendChild(headerDiv);
		
		// Create the alternatives content with better sectioning
		const alternativesDiv = document.createElement('div');
		alternativesDiv.className = 'result-item alternatives';
		alternativesDiv.innerHTML = `
			<div class="result-key">🔧 Alternatives Found</div>
			<div class="result-value">${this.formatAlternatives(alternatives)}</div>
		`;
		this.results.appendChild(alternativesDiv);
	}
	
	displayComparisonResults(html, partA, partB) {
		this.compareResults.innerHTML = '';
		
		// Create header for the comparison
		const headerDiv = document.createElement('div');
		headerDiv.className = 'result-item header';
		headerDiv.innerHTML = `
			<div class="result-key">⚖️ Comparison: ${this.escapeHtml(partA)} vs ${this.escapeHtml(partB)}</div>
			<div class="result-value">Detailed analysis with pinout diagrams and specifications</div>
		`;
		this.compareResults.appendChild(headerDiv);
		
		// Create the comparison content
		const comparisonDiv = document.createElement('div');
		comparisonDiv.className = 'result-item alternatives';
		comparisonDiv.innerHTML = `
			<div class="result-key">🔬 Comprehensive Analysis</div>
			<div class="result-value">${this.processComparisonHtml(html)}</div>
		`;
		this.compareResults.appendChild(comparisonDiv);
		
		// Add export options
		this.addExportOptions(html, partA, partB);
	}
	
	// HTML Processing
	processComparisonHtml(html) {
		let processedHtml = html;

		// Add section headers styling for h1-h6 tags
		processedHtml = processedHtml.replace(
			/<h([1-6])>(.*?)<\/h[1-6]>/g,
			'<div class="comparison-section"><h3>$2</h3></div>'
		);

		// Enhance table styling
		processedHtml = processedHtml.replace(
			/<table>/g,
			'<table class="comparison-table">'
		);

		// Add pinout diagram styling for code blocks
		processedHtml = processedHtml.replace(
			/<pre><code>([\s\S]*?)<\/code><\/pre>/g,
			'<div class="pinout-diagram"><pre>$1</pre></div>'
		);

		// Enhance pinout diagrams with better formatting
		processedHtml = processedHtml.replace(
			/(PINOUT|Pinout|pinout)/g,
			'<span class="pinout-difference">$1</span>'
		);

		// Highlight pin 1 indicators
		processedHtml = processedHtml.replace(
			/(Pin 1|PIN 1|pin 1|1\s*[•·])/g,
			'<span class="pin-1">$1</span>'
		);

		// Highlight power pins
		processedHtml = processedHtml.replace(
			/\b(VCC|VDD|VSS|GND|PWR|POWER)\b/gi,
			'<span class="pin-power">$1</span>'
		);

		// Highlight ground pins
		processedHtml = processedHtml.replace(
			/\b(GND|VSS|AGND|DGND)\b/gi,
			'<span class="pin-ground">$1</span>'
		);

		// Highlight signal pins
		processedHtml = processedHtml.replace(
			/\b(CLK|DATA|SDA|SCL|TX|RX|INT|RESET)\b/gi,
			'<span class="pin-signal">$1</span>'
		);

		// Highlight differences in text
		processedHtml = processedHtml.replace(
			/\b(different|differs|unlike|varies|change|incompatible|mismatch)\b/gi,
			'<strong class="pinout-difference">$1</strong>'
		);

		// Highlight similarities
		processedHtml = processedHtml.replace(
			/\b(same|identical|similar|compatible|match|identical|equivalent)\b/gi,
			'<em class="pinout-similar">$1</em>'
		);

		// Highlight compatibility scores
		processedHtml = processedHtml.replace(
			/(\d{1,3})%/g,
			'<span class="compatibility-score compatibility-$1">$1%</span>'
		);

		// Add CSS classes to existing table elements
		processedHtml = processedHtml.replace(
			/<thead>/g,
			'<thead class="comparison-header-row">'
		);
		processedHtml = processedHtml.replace(
			/<tbody>/g,
			'<tbody class="comparison-body">'
		);

		// Enhance ASCII art sections
		processedHtml = processedHtml.replace(
			/(┌─+┐|└─+┘|│.*│)/g,
			'<span class="ascii-art">$1</span>'
		);

		return processedHtml;
	}
	
	formatAlternatives(alternatives) {
		// The server now returns parsed HTML, so we can display it directly
		// The HTML is already sanitized by the server, so we can trust it
		return alternatives;
	}
	
	// Error Handling
	showError(message, target) {
		const targetElement = target === 'compare' ? this.compareResults : this.results;
		targetElement.innerHTML = `
			<div class="result-item error">
				<div class="result-key">⚠ Error</div>
				<div class="result-value">${this.escapeHtml(message)}</div>
			</div>
		`;
	}
	
	// Export Options
	addExportOptions(html, partA, partB) {
		const exportDiv = document.createElement('div');
		exportDiv.className = 'result-item';
		exportDiv.style.textAlign = 'center';
		exportDiv.style.padding = '20px';
		exportDiv.style.borderTop = '2px solid #e1e5e9';
		exportDiv.style.marginTop = '20px';

		exportDiv.innerHTML = `
			<div class="result-key">📋 Export Options</div>
			<div style="margin-top: 15px;">
				<button id="printBtn" style="margin: 0 10px; padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer;">
					🖨️ Print Report
				</button>
				<button id="copyBtn" style="margin: 0 10px; padding: 10px 20px; background: #4caf50; color: white; border: none; border-radius: 6px; cursor: pointer;">
					📋 Copy Text
				</button>
			</div>
		`;

		this.compareResults.appendChild(exportDiv);

		// Add event listeners for the buttons
		document.getElementById('printBtn').addEventListener('click', () => this.printReport(partA, partB));
		document.getElementById('copyBtn').addEventListener('click', () => this.copyToClipboard());
	}

	printReport(partA, partB) {
		const printWindow = window.open('', '_blank');
		const comparisonContent = document.querySelector('#compareResults .result-item.alternatives .result-value').innerHTML;
		
		printWindow.document.write(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>Part Comparison: ${partA} vs ${partB}</title>
				<style>
					body { font-family: Arial, sans-serif; margin: 20px; }
					table { border-collapse: collapse; width: 100%; margin: 20px 0; }
					th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
					th { background-color: #f2f2f2; }
					.pinout-diagram { background: #f5f5f5; border: 1px solid #ddd; padding: 15px; margin: 15px 0; font-family: monospace; white-space: pre; }
					.comparison-section { margin: 20px 0; padding: 10px; background: #f9f9f9; border-left: 3px solid #667eea; }
					@media print { body { margin: 0; } }
				</style>
			</head>
			<body>
				<h1>Part Comparison Report</h1>
				<h2>${partA} vs ${partB}</h2>
				<hr>
				${comparisonContent}
			</body>
			</html>
		`);
		
		printWindow.document.close();
		printWindow.focus();
		
		setTimeout(() => {
			printWindow.print();
			printWindow.close();
		}, 500);
	}

	async copyToClipboard() {
		try {
			const comparisonContent = document.querySelector('#compareResults .result-item.alternatives .result-value');
			if (!comparisonContent) {
				throw new Error('No comparison content found');
			}

			const textContent = comparisonContent.textContent || comparisonContent.innerText;
			
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(textContent);
				this.showCopySuccess();
			} else {
				this.fallbackCopyTextToClipboard(textContent);
			}
		} catch (error) {
			console.error('Copy failed:', error);
			const comparisonContent = document.querySelector('#compareResults .result-item.alternatives .result-value');
			if (comparisonContent) {
				this.fallbackCopyTextToClipboard(comparisonContent.textContent || comparisonContent.innerText);
			}
		}
	}

	fallbackCopyTextToClipboard(text) {
		const textArea = document.createElement('textarea');
		textArea.value = text;
		textArea.style.position = 'fixed';
		textArea.style.left = '-999999px';
		textArea.style.top = '-999999px';
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();
		
		try {
			document.execCommand('copy');
			this.showCopySuccess();
		} catch (err) {
			console.error('Fallback copy failed:', err);
			this.showCopyError();
		}
		
		document.body.removeChild(textArea);
	}

	showCopySuccess() {
		const copyBtn = document.getElementById('copyBtn');
		const originalText = copyBtn.innerHTML;
		copyBtn.innerHTML = '✅ Copied!';
		copyBtn.style.background = '#4caf50';
		
		setTimeout(() => {
			copyBtn.innerHTML = originalText;
			copyBtn.style.background = '#4caf50';
		}, 2000);
	}

	showCopyError() {
		const copyBtn = document.getElementById('copyBtn');
		const originalText = copyBtn.innerHTML;
		copyBtn.innerHTML = '⚠ Failed';
		copyBtn.style.background = '#f44336';
		
		setTimeout(() => {
			copyBtn.innerHTML = originalText;
			copyBtn.style.background = '#4caf50';
		}, 2000);
	}
	
	// Utility Methods
	escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
	new PartAnalysisTool();
});