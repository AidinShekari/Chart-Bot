const { Client, Intents } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');
const { createCanvas } = require('canvas');
const Chart = require('chart.js');
const { DateTime } = require('luxon');
const path = require('path');

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
const DISCORD_TOKEN = 'Discord-Token';
const CHANNEL_HOUR_ID = 'Channel-Hour';
const CHANNEL_END_OF_DAY_ID = 'Channel-End-Day';
const HOURLY_DATA_FILE = 'hourlydata.json';
const CHARTS_DIR = './charts';

client.once('ready', async () => {
  console.log('Bot is ready');
  const channelHour = await client.channels.fetch(CHANNEL_HOUR_ID);
  const channelEndOfDay = await client.channels.fetch(CHANNEL_END_OF_DAY_ID);
  if (channelHour && channelEndOfDay) {
    updateHourlyEmbed(channelHour);
    setInterval(() => updateHourlyEmbed(channelHour), 30000);
    scheduleEndOfDayLog(channelEndOfDay);
  } else {
    console.error('Channel not found');
  }
});

client.login(DISCORD_TOKEN);

async function updateHourlyEmbed(channel) {
  const hourlyData = await getVnstatData();
  if (hourlyData.length > 0) {
    saveHourlyData(hourlyData);
    const chartPath = await generateChart(hourlyData);
    await sendOrUpdateDiscordEmbed(channel, hourlyData, chartPath);
  } else {
    console.error("No data available for the current day.");
  }
}

async function scheduleEndOfDayLog(channel) {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const timeUntilMidnight = midnight - now;

  setTimeout(async () => {
    const today = new Date().toISOString().split('T')[0];
    const hourlyData = loadHourlyData(today);
    if (hourlyData.length > 0) {
      const chartPath = await generateChart(hourlyData);
      await sendEndOfDayLog(channel, hourlyData, chartPath);
    } else {
      console.error("No data available for the current day.");
    }
    scheduleEndOfDayLog(channel);
    resetHourlyData(today);
  }, timeUntilMidnight);
}

async function sendEndOfDayLog(channel, hourlyData, chartPath) {
  if (hourlyData.length === 0) {
    console.error("No data available for the end of day log.");
    return;
  }

  const maxUsage = hourlyData.reduce((max, item) => parseFloat(item.Total_Data) > parseFloat(max.Total_Data) ? item : max, hourlyData[0]);
  const mostUsageTime = `${maxUsage.Time} with ${maxUsage.Total_Data} GB`;
  const totalUsage = hourlyData.reduce((sum, item) => sum + parseFloat(item.Total_Data), 0).toFixed(2);
  const today = new Date().toISOString().split('T')[0];

  const embed = {
    title: `📅 End of Day Usage | ${today}`,
    description: `🔋 **Most Usage Time**: (${mostUsageTime})\n📊 **Total Usage Today**: ${totalUsage} GB`,
    color: '#ffffff',
    image: {
      url: `attachment://${chartPath}`
    },
    timestamp: new Date()
  };

  const files = [{
    attachment: chartPath,
    name: 'chart.png'
  }];

  await channel.send({ embeds: [embed], files });
}

function parseVnstatData(data) {
  const lines = data.split('\n');
  const hourlyData = [];

  const iranTime = DateTime.now().setZone('Asia/Tehran');
  const today = iranTime.toISODate();

  let parsingTodayData = false;

  lines.forEach(line => {
    const dateMatch = line.match(/^\s*(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const currentDate = dateMatch[1];
      parsingTodayData = currentDate === today;
    } else if (parsingTodayData) {
      const match = line.match(/^\s*(\d{2}:\d{2})\s+(\d+\.\d+|\d+)\s+([KMG]i?B)\s+\|\s+(\d+\.\d+|\d+)\s+([KMG]i?B)\s+\|\s+(\d+\.\d+|\d+)\s+([KMG]i?B)/);
      if (match) {
        const hour = match[1];
        const totalValue = parseFloat(match[6]);
        const totalUnit = match[7];
        const totalGB = convertToGB(totalValue, totalUnit);

        hourlyData.push({
          Date: today,
          Time: hour,
          Total_Data: totalGB.toFixed(2)
        });
      }
    }
  });

  return hourlyData;
}

function convertToGB(value, unit) {
  const units = {
    B: 1 / (1024 ** 3),
    KiB: 1 / (1024 ** 2),
    MiB: 1 / 1024,
    GiB: 1,
    KB: 1 / (1000 ** 3),
    MB: 1 / (1000 ** 2),
    GB: 1,
  };
  return value * (units[unit] || 1);
}

async function generateChart(hourlyData) {
  const canvas = createCanvas(600, 400);
  const ctx = canvas.getContext('2d');

  const labels = hourlyData.map(item => item.Time);
  const data = hourlyData.map(item => parseFloat(item.Total_Data));

  const backgroundColorPlugin = {
    id: 'customCanvasBackgroundColor',
    beforeDraw: (chart) => {
      const ctx = chart.ctx;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, chart.width, chart.height);
    }
  };

  new Chart(ctx, {
    type: 'line',
    plugins: [backgroundColorPlugin],
    data: {
      labels: labels,
      datasets: [{
        label: 'Total Data (GB)',
        data: data,
        borderColor: 'rgba(33, 145, 81, 1)',
        backgroundColor: 'rgba(33, 145, 81, 0.2)',
        fill: true,
        tension: 0.1,
        pointStyle: 'circle',
        pointBackgroundColor: 'rgba(33, 145, 81, 1)',
        pointRadius: 5,
        pointBorderWidth: 3
      }]
    },
    options: {
      scales: {
        x: {
          title: {
            display: true,
            text: 'Time',
            color: '#ffffff'
          },
          ticks: {
            color: '#ffffff'
          }
        },
        y: {
          title: {
            display: true,
            text: 'Total Data (GB)',
            color: '#ffffff'
          },
          ticks: {
            color: '#ffffff',
            stepSize: 1,
            beginAtZero: true
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#ffffff'
          }
        }
      }
    }
  });

  const chartPath = 'chart.png';
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(chartPath, buffer);
  return chartPath;
}

async function sendOrUpdateDiscordEmbed(channel, hourlyData, chartPath) {
  if (hourlyData.length > 0) {
    const maxUsage = hourlyData.reduce((max, item) => parseFloat(item.Total_Data) > parseFloat(max.Total_Data) ? item : max, hourlyData[0]);
    const mostUsageTime = `${maxUsage.Time} with ${maxUsage.Total_Data} GB`;

    const thisHour = hourlyData[hourlyData.length - 1];
    const thisHourUsage = `${thisHour.Time} Usage: ${thisHour.Total_Data} GB`;

    const totalUsage = hourlyData.reduce((sum, item) => sum + parseFloat(item.Total_Data), 0).toFixed(2);
    const totalUsageMessage = `📊 **Total Usage Today**: ${totalUsage} GB`;

    const messages = await channel.messages.fetch({ limit: 1 });
    const lastMessage = messages.first();

    const embed = {
      title: `⚠️ Today Usage By Hour | ${thisHour.Time}`,
      description: `⏰ **This Hour**: (${thisHourUsage})\n\n🔋 **Most Usage Time**: (${mostUsageTime})\n${totalUsageMessage}`,
      color: '#ffffff',
      image: {
        url: `attachment://${chartPath}`
      },
      timestamp: new Date()
    };

    const files = [{
      attachment: chartPath,
      name: 'chart.png'
    }];

    if (lastMessage && lastMessage.author.id === client.user.id) {
      await lastMessage.edit({ embeds: [embed], files });
    } else {
      await channel.send({ embeds: [embed], files });
    }
  } else {
    console.error("No data available for the current day.");
  }
}

function getVnstatData() {
  return new Promise((resolve, reject) => {
    exec('vnstat -h', (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error);
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`);
        reject(stderr);
      }

      const hourlyData = parseVnstatData(stdout);
      hourlyData.sort((a, b) => a.Time.localeCompare(b.Time));
      resolve(hourlyData);
    });
  });
}

function loadHourlyData(date) {
  const filePath = path.join(CHARTS_DIR, `${date}.json`);
  if (fs.existsSync(filePath)) {
    const rawData = fs.readFileSync(filePath);
    return JSON.parse(rawData);
  }
  return [];
}

function saveHourlyData(data) {
  const today = new Date().toISOString().split('T')[0];
  const filePath = path.join(CHARTS_DIR, `${today}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function resetHourlyData(date) {
  const filePath = path.join(CHARTS_DIR, `${date}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
