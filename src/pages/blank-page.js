import React, { useState, useEffect } from "react";
import { FaMicrophone, FaMicrophoneSlash } from "react-icons/fa";
import {
  Card,
  CardContent,
  Typography,
  CardActionArea,
  CardMedia,
} from "@mui/material";
import { mobile_data } from "../helpers/data";
import { GoogleGenerativeAI } from "@google/generative-ai";
import AlertSnackbar from "./AlertSnackbar";
import alasql from "alasql";

const apiKey = "AIzaSyB8sj23ffW1rf5UlhVJU2Nms18GC4VVpYQ";
const genAI = new GoogleGenerativeAI(apiKey);

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

const GenAiMenu = async (transcript) => {
  try {
    const prompt = `
    Analyze this sales transcript and generate two SQL queries in the following exact format:

    Exact Match Query:
    SELECT ... FROM mobile_data WHERE ...

    Recommended Products Query:
    SELECT ... FROM mobile_data WHERE ...

    Each query should retrieve fields like brand, product_img, product_name, ram, screen_size, storage, battery, camera, price.
    The fields ram, screen_size, camera, price, and battery in the mobile_data table are stored as integers.
    The exact match query should filter products based on strict match criteria, while the recommended products query should filter for similar products based on the same or other brands (Samsung, Realme, Oppo, Motorola, iPhone, etc.) and integer averages for brand, ram, screen_size, and battery values.

    Transcript:
    ${transcript}

    Return only the queries in the specified format, using integer comparisons where needed.
    `;

    const result = await genAI
      .getGenerativeModel({ model: "gemini-1.5-flash" })
      .generateContent(prompt);

    if (result.response.candidates.length > 0) {
      const queriesText = result.response.candidates[0].content.parts[0].text.trim();
      const cleanedText = queriesText
        .replace(/```sql/g, "")
        .replace(/```/g, "")
        .replace(/##/g, "")
        .trim();

      const exactMatchRegex = /Exact Match Query:\s*(SELECT.*?FROM.*?)(?=\n\s*\n|$)/s;
      const recommendedQueryRegex = /Recommended Products Query:\s*(SELECT.*?FROM.*?)(?=\n\s*\n|$)/s;

      const exactMatchMatch = exactMatchRegex.exec(cleanedText);
      const recommendedQueryMatch = recommendedQueryRegex.exec(cleanedText);

      const exactQuery = exactMatchMatch ? exactMatchMatch[1].trim() : "";
      const recommendationQuery = recommendedQueryMatch ? recommendedQueryMatch[1].trim() : "";

      return { exactQuery, recommendationQuery };
    }
    return { exactQuery: "", recommendationQuery: "" };
  } catch (error) {
    console.error("Error with GenAI API:", error);
    return { exactQuery: "", recommendationQuery: "" };
  }
};

const HomePage = () => {
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);
  const [filteredData, setFilteredData] = useState([]);
  const [recommendedData, setRecommendedData] = useState([]);
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [status, setStatus] = useState("idle");

  // Initialize mobile data in alasql
  useEffect(() => {
    try {
      alasql(
        "CREATE TABLE IF NOT EXISTS mobile_data (brand STRING, ram INT, screen_size INT, storage INT, battery INT, camera INT, price INT, product_name STRING, product_img STRING)"
      );
      alasql("DELETE FROM mobile_data");

      mobile_data.forEach((item) => {
        alasql("INSERT INTO mobile_data VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
          item.brand,
          item.ram,
          item.screen_size,
          item.storage,
          item.battery,
          item.camera,
          item.Price,
          item.product_name,
          item.product_img,
        ]);
      });
    } catch (error) {
      console.error("Error initializing database:", error);
      setSnackbarMessage("Error initializing database. Please refresh the page.");
      setOpenSnackbar(true);
    }
  }, []);

  // Initialize SpeechRecognition
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = true;
      recognitionInstance.interimResults = true;
      recognitionInstance.lang = "en-US";

      recognitionInstance.onresult = handleSpeechResult;
      recognitionInstance.onerror = handleError;
      recognitionInstance.onend = () => {
        // Only restart if we're still in listening mode and not processing
        if (isListening && status !== "processing") {
          recognitionInstance.start();
        }
      };

      setRecognition(recognitionInstance);
    } else {
      setSnackbarMessage("Speech Recognition not supported in this browser");
      setOpenSnackbar(true);
    }
  }, [isListening, status]);

  const handleSpeechResult = (event) => {
    let currentTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        currentTranscript += event.results[i][0].transcript;
      }
    }
    if (currentTranscript.trim()) {
      setTranscript(currentTranscript);
      processTranscript(currentTranscript);
    }
  };

  const handleError = (event) => {
    console.error("Speech recognition error", event.error);
    console.error("Speech recognition error details:", event);

    if (event.error === "aborted") {
      setSnackbarMessage("Speech recognition was aborted. Please try again.");
    } else {
      setSnackbarMessage(`Speech recognition error: ${event.error}. Retrying in 3 seconds...`);
      setTimeout(() => {
        startListening();
      }, 3000);
    }

    setIsListening(false);
    setStatus("idle");
    setOpenSnackbar(true);
  };

  const processTranscript = async (currentTranscript) => {
    try {
      setStatus("processing");
      stopListening();

      const result = await GenAiMenu(currentTranscript);

      if (result.exactQuery) {
        try {
          const exactProducts = alasql(result.exactQuery);
          setFilteredData(exactProducts);
        } catch (error) {
          console.error("Error executing exact query:", error);
          setFilteredData([]);
        }
      }

      if (result.recommendationQuery) {
        try {
          const recommendations = alasql(result.recommendationQuery);
          setRecommendedData(recommendations);
        } catch (error) {
          console.error("Error executing recommendation query:", error);
          setRecommendedData([]);
        }
      }

      setSnackbarMessage("Search completed successfully!");
      setOpenSnackbar(true);
    } catch (error) {
      console.error("Error processing transcript:", error);
      setSnackbarMessage("Error processing your request. Please try again.");
      setOpenSnackbar(true);
      setFilteredData([]);
      setRecommendedData([]);
    } finally {
      setStatus("idle");
    }
  };

  const startListening = () => {
    if (recognition) {
      setTranscript("");
      setFilteredData([]);
      setRecommendedData([]);
      setStatus("listening");
      setIsListening(true);
      recognition.start();
    }
  };

  const stopListening = () => {
    if (recognition) {
      recognition.stop();
      setIsListening(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      <div className="grid grid-cols-4 w-full  max-w-7xl">
        <div className="col-span-1 bg-white rounded-lg shadow-lg p-6 flex flex-col items-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-6">Speech to Text</h1>

          <div className="w-full mb-6">
            <button
              onClick={isListening ? stopListening : startListening}
              className={`w-full flex justify-center items-center ${isListening
                ? "bg-red-500 hover:bg-red-600"
                : "bg-gradient-to-r from-[#0b73b7] to-[#ea8827] hover:from-[#0b73b7] hover:to-[#ea8827]"
                } text-white px-6 py-3 rounded-lg text-xl transition duration-300 transform hover:scale-105`}
              disabled={!recognition || status === "processing"}
            >
              {isListening ? (
                <>
                  <FaMicrophoneSlash className="mr-4 text-xl" />
                  Stop Speaking
                </>
              ) : (
                <>
                  <FaMicrophone className="mr-4 text-xl" />
                  Start Speaking
                </>
              )}
            </button>
          </div>

          <div className="w-full mt-6 p-4 bg-gray-100 rounded-lg shadow-inner">
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              Transcript:
            </h3>
            <p className="text-lg text-gray-800">
              {transcript || "Your speech will appear here..."}
            </p>
          </div>
        </div>

        <div className="col-span-3 bg-gray-50 items-center ">
          <h2 className="text-xl font-semibold mb-4">Product Matches</h2>
          <div className="overflow-x-auto">
            <div className="flex space-x-6">
              {filteredData.map((item, index) => (
                <Card key={index} sx={{ maxWidth: 345 }} className="flex-none">
                  <CardActionArea>
                    <CardMedia
                      component="img"
                      height="100"
                      width="150"
                      image={item.product_img}
                      alt={item.brand || "Mobile Image"}
                    />
                    <CardContent>
                      <div className="text-md font-bold">
                        {item.product_name || "Product Name"}
                      </div>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        RAM: {item.ram} GB | Storage: {item.storage} GB | Battery:{" "}
                        {item.battery} mAh
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        Price: {item.price}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </div>
          </div>


          <h2 className="text-xl font-semibold mt-8 mb-4">Recommended Products</h2>
          <div className="overflow-x-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 min-w-max">
              {recommendedData?.slice(0, 3).map((item, index) => (
                <Card key={index} sx={{ maxWidth: 345 }} className="flex-none">
                  <CardActionArea>
                    <CardMedia
                      component="img"
                      height="140"
                      image={item.product_img}
                      alt={item.brand || "Mobile Image"}
                    />
                    <CardContent>
                      <div className="text-md font-bold ">
                        {item.product_name || "Product Name"}
                      </div>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        RAM: {item.ram} GB | Storage: {item.storage} GB | Battery:{" "}
                        {item.battery} mAh
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        Price: {item.price}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </div>

          </div>

        </div>
      </div>

      <AlertSnackbar
        open={openSnackbar}
        onClose={() => setOpenSnackbar(false)}
        message={snackbarMessage}
      />
    </div>
  );
};

export default HomePage;