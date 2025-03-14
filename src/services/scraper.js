const axios = require("axios");
const cheerio = require("cheerio");
const natural = require("natural");
const cron = require("node-cron");

// Initialize sentiment analyzer
const analyzer = new natural.SentimentAnalyzer(
  "English",
  natural.PorterStemmer,
  "afinn"
);

// Store scraped news
let newsCache = [];

const sources = [
  {
    name: "Times of India",
    url: "https://timesofindia.indiatimes.com/briefs/india",
    selectors: {
      articles: ".brief_box",
      title: ".brief_box h2",
      content: ".brief_box p",
      link: ".brief_box a",
    },
  },
  {
    name: "NDTV",
    url: "https://www.ndtv.com/latest",
    selectors: {
      articles: ".news_Itm-cont",
      title: ".newsHdng",
      content: ".newsCont, .post_content",
      link: ".newsHdng a",
    },
  },
  {
    name: "Hindustan Times",
    url: "https://www.hindustantimes.com/india-news",
    selectors: {
      articles: ".storyCard, .hdg3",
      title: "h3 a, .hdg3 a",
      content: ".detail, .storyDetail, .sortDec, .storyParagraph",
      link: "h3 a, .hdg3 a",
    },
  },
  {
    name: "India Today",
    url: "https://www.indiatoday.in/india",
    selectors: {
      articles: "div.story__grid article",
      title: "h2.story__title a",
      content: "p.story__description",
      link: "h2.story__title a",
    },
  },
  {
    name: "The Hindu",
    url: "https://www.thehindu.com/latest-news/",
    selectors: {
      articles: ".timeline-container .timeline-item",
      title: ".title a, h3 a",
      content: ".intro, .story-card-text",
      link: ".title a, h3 a",
    },
  },
];

// Add more robust headers and cookies
const axiosConfig = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua":
      '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    Referer: "https://www.indiatoday.in",
  },
  timeout: 15000,
  withCredentials: true,
};

const categorizeArticle = (text) => {
  const topics = {
    politics: [
      "government",
      "minister",
      "election",
      "party",
      "parliament",
      "policy",
      "congress",
      "bjp",
      "political",
      "leader",
      "democracy",
      "vote",
      "campaign"
    ],
    health: [
      "hospital",
      "medical",
      "health",
      "disease",
      "covid",
      "doctor",
      "vaccine",
      "treatment",
      "patient",
      "medicine",
      "healthcare",
      "wellness",
      "clinic"
    ],
    world: [
      "international",
      "global",
      "foreign",
      "world",
      "diplomatic",
      "embassy",
      "overseas",
      "bilateral",
      "multinational",
      "united nations",
      "summit",
      "treaty"
    ],
  };

  const words = text.toLowerCase().split(" ");
  const scores = {};

  Object.keys(topics).forEach((topic) => {
    scores[topic] = words.filter((word) =>
      topics[topic].some((keyword) => word.includes(keyword))
    ).length;
  });

  return Object.entries(scores).reduce((a, b) => (a[1] > b[1] ? a : b))[0];
};

const extractEntities = (text) => {
  const tokenizer = new natural.WordTokenizer();
  const words = tokenizer.tokenize(text);

  // Simple named entity recognition (can be improved with more sophisticated NLP)
  const states = ["delhi", "mumbai", "kerala", "gujarat", "punjab"];
  const foundStates = states.filter((state) =>
    text.toLowerCase().includes(state)
  );

  // Extract potential person names (words starting with capital letters)
  const persons = words.filter(
    (word) => /^[A-Z][a-z]+$/.test(word) && word.length > 2
  );

  return {
    states: foundStates,
    people: [...new Set(persons)],
  };
};

const scrapeArticle = async (source) => {
  try {
    console.log(`Attempting to scrape ${source.name} from ${source.url}`);
    const response = await axios.get(source.url, axiosConfig);
    console.log(`Successfully fetched ${source.name} page`);
    const $ = cheerio.load(response.data);
    const articles = [];

    // Debug: Log the number of article elements found
    const articleElements = $(source.selectors.articles);
    console.log(
      `Found ${articleElements.length} article elements for ${source.name}`
    );

    articleElements.each((i, element) => {
      if (i < 5) {
        const titleElement = $(element).find(source.selectors.title);
        const contentElement = $(element).find(source.selectors.content);
        const linkElement = $(element).find(source.selectors.link);

        // Debug: Log what we found for each element
        console.log(`\nArticle ${i + 1} from ${source.name}:`);
        console.log(`Title selector found: ${titleElement.length > 0}`);
        console.log(`Content selector found: ${contentElement.length > 0}`);
        console.log(`Link selector found: ${linkElement.length > 0}`);

        let title = titleElement.text().trim();
        let content = contentElement.text().trim();
        let link = linkElement.attr("href") || "";

        // Additional debugging for India Today links
        if (source.name === "India Today") {
          console.log("India Today Link Details:");
          console.log("Raw link element:", linkElement.html());
          console.log("Link href:", link);
          console.log(
            "All links in article:",
            $(element)
              .find("a")
              .map((_, el) => $(el).attr("href"))
              .get()
          );
        }

        // Debug: Log the extracted content
        console.log(`Title length: ${title.length}`);
        console.log(`Content length: ${content.length}`);
        console.log(`Link found: ${link ? "yes" : "no"}`);

        // Make relative URLs absolute
        if (link && !link.startsWith("http")) {
          if (source.name === "India Today") {
            // Special handling for India Today URLs
            link = `https://www.indiatoday.in${
              link.startsWith("/") ? "" : "/"
            }${link}`;
          } else {
            const baseUrl = new URL(source.url);
            link = `${baseUrl.protocol}//${baseUrl.host}${link}`;
          }
        }

        // If content is empty, try getting text from the article element itself
        if (!content) {
          content = $(element).text().trim();
          console.log("Using fallback content from article element");
        }

        // If no specific title found, use the first sentence of content as title
        if (!title && content) {
          const firstSentence = content.split(".")[0];
          title =
            firstSentence.length > 60
              ? firstSentence.substring(0, 60) + "..."
              : firstSentence;
          content = content.substring(title.length);
          console.log("Using fallback title from content");
        }

        if (title || content) {
          const summary = content.split(" ").slice(0, 30).join(" ") + "...";
          const sentiment = analyzer.getSentiment(
            (content || title).split(" ")
          );
          const topic = categorizeArticle(content || title);
          const entities = extractEntities(content || title);

          articles.push({
            source: source.name,
            title: title || "Untitled Article",
            summary: summary || title,
            topic,
            sentiment: sentiment.toFixed(2),
            entities,
            timestamp: new Date(),
            url: link,
          });
          console.log(
            `Successfully added article: ${
              title ? title.substring(0, 50) + "..." : "Untitled Article"
            }`
          );
        } else {
          console.log("Skipping article - no title or content found");
        }
      }
    });

    console.log(
      `Successfully scraped ${articles.length} articles from ${source.name}`
    );
    return articles;
  } catch (error) {
    console.error(`Error scraping ${source.name}:`, error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response headers:", error.response.headers);
    }
    // Debug: Log the full error
    console.error("Full error:", error);
    return [];
  }
};

const updateNews = async () => {
  console.log("Starting news update...");
  let allArticles = [];

  for (const source of sources) {
    console.log(`Processing source: ${source.name}`);
    const articles = await scrapeArticle(source);
    allArticles.push(...articles);
  }

  newsCache = allArticles;
  console.log(`Update complete. Total articles: ${allArticles.length}`);
};

const setupNewsScraping = () => {
  // Update news immediately on startup
  updateNews();

  // Schedule updates every 30 minutes
  cron.schedule("*/30 * * * *", updateNews);
};

const getNews = () => newsCache;

module.exports = {
  setupNewsScraping,
  getNews,
};
