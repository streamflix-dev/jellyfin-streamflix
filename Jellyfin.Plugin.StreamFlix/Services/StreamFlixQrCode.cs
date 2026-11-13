using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Jellyfin.Plugin.StreamFlix.Services;

/// <summary>
/// Self-contained, zero-dependency ISO/IEC 18004 QR Code SVG generator (Byte mode, ECC Level M, Versions 1–14).
/// Generates scannable QR codes locally on the Jellyfin server without any external HTTP requests or third-party assemblies.
/// </summary>
public static class StreamFlixQrCode
{
    // ISO/IEC 18004 Table 9 — ECC Level M: (EcCodewordsPerBlock, NumBlocks) for Versions 1..14
    private static readonly (int EcPerBlock, int NumBlocks)[] LevelMTable =
    {
        (0, 0),   // unused v0
        (10, 1),  // v1  (max 14 bytes)
        (16, 1),  // v2  (max 26 bytes)
        (26, 1),  // v3  (max 42 bytes)
        (18, 2),  // v4  (max 62 bytes)
        (24, 2),  // v5  (max 84 bytes)
        (16, 4),  // v6  (max 106 bytes)
        (18, 4),  // v7  (max 122 bytes)
        (22, 4),  // v8  (max 152 bytes)
        (22, 5),  // v9  (max 180 bytes)
        (26, 5),  // v10 (max 213 bytes)
        (30, 5),  // v11 (max 251 bytes)
        (22, 8),  // v12 (max 287 bytes)
        (22, 9),  // v13 (max 331 bytes)
        (24, 9),  // v14 (max 362 bytes)
    };

    private static readonly int[] RawCodewordsByVersion =
    {
        0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581,
    };

    /// <summary>
    /// Encodes a UTF-8 string (up to 360 UTF-8 bytes) as a crisp, standalone SVG QR Code.
    /// </summary>
    public static string GenerateSvg(string payload, int borderModules = 3)
    {
        if (string.IsNullOrEmpty(payload))
        {
            return string.Empty;
        }

        var utf8 = Encoding.UTF8.GetBytes(payload);
        var version = SelectVersion(utf8.Length);
        if (version < 0)
        {
            return string.Empty;
        }

        var dataCodewords = EncodeDataCodewords(utf8, version);
        var allCodewords = AddErrorCorrectionAndInterleave(dataCodewords, version);
        var size = (version * 4) + 17;

        var modules = new bool[size, size];
        var isFunction = new bool[size, size];

        DrawFunctionPatterns(version, size, modules, isFunction);
        DrawCodewords(allCodewords, size, modules, isFunction);

        // Choose the mask pattern (0..7) with the lowest ISO/IEC 18004 visual penalty score
        var bestMask = 0;
        var minPenalty = int.MaxValue;
        for (var mask = 0; mask < 8; mask++)
        {
            ApplyMask(mask, size, modules, isFunction);
            DrawFormatBits(mask, size, modules, isFunction);
            var penalty = ComputePenaltyScore(size, modules);
            if (penalty < minPenalty)
            {
                minPenalty = penalty;
                bestMask = mask;
            }

            // Revert XOR mask before testing the next mask
            ApplyMask(mask, size, modules, isFunction);
        }

        ApplyMask(bestMask, size, modules, isFunction);
        DrawFormatBits(bestMask, size, modules, isFunction);

        var pad = Math.Clamp(borderModules, 1, 8);
        var viewSize = size + (pad * 2);
        var sb = new StringBuilder(2048);
        sb.Append("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ");
        sb.Append(viewSize.ToString(CultureInfo.InvariantCulture));
        sb.Append(' ');
        sb.Append(viewSize.ToString(CultureInfo.InvariantCulture));
        sb.Append("\" shape-rendering=\"crispEdges\" role=\"img\" aria-label=\"Guest Pass QR Code\">");
        sb.Append("<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\" rx=\"2\"/>");
        sb.Append("<path fill=\"#000000\" d=\"");

        for (var r = 0; r < size; r++)
        {
            var c = 0;
            while (c < size)
            {
                if (!modules[r, c])
                {
                    c++;
                    continue;
                }

                // Merge contiguous horizontal dark modules into a single rectangle command for compact SVG output
                var run = 1;
                while (c + run < size && modules[r, c + run])
                {
                    run++;
                }

                sb.Append('M');
                sb.Append((c + pad).ToString(CultureInfo.InvariantCulture));
                sb.Append(',');
                sb.Append((r + pad).ToString(CultureInfo.InvariantCulture));
                sb.Append('h');
                sb.Append(run.ToString(CultureInfo.InvariantCulture));
                sb.Append("v1h-");
                sb.Append(run.ToString(CultureInfo.InvariantCulture));
                sb.Append('z');
                c += run;
            }
        }

        sb.Append("\"/></svg>");
        return sb.ToString();
    }

    private static int SelectVersion(int byteLength)
    {
        for (var v = 1; v <= 14; v++)
        {
            var (ecPerBlock, numBlocks) = LevelMTable[v];
            var dataCodewords = RawCodewordsByVersion[v] - (ecPerBlock * numBlocks);
            var headerBytes = v < 10 ? 2 : 3; // 4 mode bits + 8/16 count bits + 4 terminator/align bits
            if (byteLength <= dataCodewords - headerBytes)
            {
                return v;
            }
        }

        return -1;
    }

    private static byte[] EncodeDataCodewords(byte[] utf8, int version)
    {
        var (ecPerBlock, numBlocks) = LevelMTable[version];
        var capacityCodewords = RawCodewordsByVersion[version] - (ecPerBlock * numBlocks);
        var capacityBits = capacityCodewords * 8;

        var bits = new List<bool>(capacityBits);
        AppendBits(0b0100, 4, bits); // Byte mode indicator
        AppendBits(utf8.Length, version < 10 ? 8 : 16, bits);
        foreach (var b in utf8)
        {
            AppendBits(b, 8, bits);
        }

        // Up to 4 zero terminator bits
        var terminatorLen = Math.Min(4, capacityBits - bits.Count);
        AppendBits(0, terminatorLen, bits);

        // Pad to byte boundary
        while ((bits.Count & 7) != 0)
        {
            bits.Add(false);
        }

        // Pad remaining bytes alternating 0xEC and 0x11
        byte padToggle = 0xEC;
        while (bits.Count < capacityBits)
        {
            AppendBits(padToggle, 8, bits);
            padToggle = padToggle == 0xEC ? (byte)0x11 : (byte)0xEC;
        }

        var result = new byte[capacityCodewords];
        for (var i = 0; i < bits.Count; i++)
        {
            if (bits[i])
            {
                result[i >> 3] |= (byte)(1 << (7 - (i & 7)));
            }
        }

        return result;
    }

    private static byte[] AddErrorCorrectionAndInterleave(byte[] data, int version)
    {
        var (ecLen, numBlocks) = LevelMTable[version];
        var rawCodewords = RawCodewordsByVersion[version];
        var numShortBlocks = numBlocks - (data.Length % numBlocks);
        var shortDataLen = data.Length / numBlocks;

        var rsDiv = BuildReedSolomonDivisor(ecLen);
        var blocks = new byte[numBlocks][];
        var offset = 0;

        for (var i = 0; i < numBlocks; i++)
        {
            var datLen = shortDataLen + (i < numShortBlocks ? 0 : 1);
            var dat = new byte[datLen];
            Buffer.BlockCopy(data, offset, dat, 0, datLen);
            offset += datLen;

            var ec = ComputeReedSolomonRemainder(dat, rsDiv);
            var block = new byte[datLen + ecLen];
            Buffer.BlockCopy(dat, 0, block, 0, datLen);
            Buffer.BlockCopy(ec, 0, block, datLen, ecLen);
            blocks[i] = block;
        }

        var result = new byte[rawCodewords];
        var pos = 0;
        var maxDataLen = shortDataLen + 1;
        for (var col = 0; col < maxDataLen; col++)
        {
            for (var b = 0; b < numBlocks; b++)
            {
                if (col == shortDataLen && b < numShortBlocks)
                {
                    continue;
                }

                result[pos++] = blocks[b][col];
            }
        }

        for (var col = 0; col < ecLen; col++)
        {
            for (var b = 0; b < numBlocks; b++)
            {
                var ecOffset = (b < numShortBlocks ? shortDataLen : shortDataLen + 1) + col;
                result[pos++] = blocks[b][ecOffset];
            }
        }

        return result;
    }

    private static void DrawFunctionPatterns(int version, int size, bool[,] modules, bool[,] isFunction)
    {
        // Timing patterns
        for (var i = 0; i < size; i++)
        {
            SetFunctionModule(6, i, (i & 1) == 0, modules, isFunction);
            SetFunctionModule(i, 6, (i & 1) == 0, modules, isFunction);
        }

        // Three 7x7 finder patterns + 1-module white separators (centered at (3,3), (3,size-4), (size-4,3))
        DrawFinderPattern(3, 3, size, modules, isFunction);
        DrawFinderPattern(3, size - 4, size, modules, isFunction);
        DrawFinderPattern(size - 4, 3, size, modules, isFunction);

        // Alignment patterns (v2+)
        var alignCoords = GetAlignmentPatternPositions(version, size);
        for (var i = 0; i < alignCoords.Length; i++)
        {
            for (var j = 0; j < alignCoords.Length; j++)
            {
                if ((i == 0 && j == 0)
                    || (i == 0 && j == alignCoords.Length - 1)
                    || (i == alignCoords.Length - 1 && j == 0))
                {
                    continue;
                }

                DrawAlignmentPattern(alignCoords[i], alignCoords[j], modules, isFunction);
            }
        }

        // Reserve format bits & dark module
        DrawFormatBits(0, size, modules, isFunction);

        // Draw version information blocks (v7+)
        if (version >= 7)
        {
            var rem = version;
            for (var i = 0; i < 12; i++)
            {
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
            }

            var bits = (version << 12) | rem;
            for (var i = 0; i < 18; i++)
            {
                var dark = ((bits >> i) & 1) != 0;
                var a = size - 11 + (i % 3);
                var b = i / 3;
                SetFunctionModule(a, b, dark, modules, isFunction);
                SetFunctionModule(b, a, dark, modules, isFunction);
            }
        }
    }

    private static void DrawFinderPattern(int centerR, int centerC, int size, bool[,] modules, bool[,] isFunction)
    {
        for (var dr = -4; dr <= 4; dr++)
        {
            for (var dc = -4; dc <= 4; dc++)
            {
                var r = centerR + dr;
                var c = centerC + dc;
                if (r >= 0 && r < size && c >= 0 && c < size)
                {
                    var dist = Math.Max(Math.Abs(dr), Math.Abs(dc));
                    SetFunctionModule(r, c, dist != 2 && dist != 4, modules, isFunction);
                }
            }
        }
    }

    private static void DrawAlignmentPattern(int centerR, int centerC, bool[,] modules, bool[,] isFunction)
    {
        for (var dr = -2; dr <= 2; dr++)
        {
            for (var dc = -2; dc <= 2; dc++)
            {
                var dist = Math.Max(Math.Abs(dr), Math.Abs(dc));
                SetFunctionModule(centerR + dr, centerC + dc, dist != 1, modules, isFunction);
            }
        }
    }

    private static void DrawFormatBits(int mask, int size, bool[,] modules, bool[,] isFunction)
    {
        // ECC Level M format indicator = 0b00
        var data = mask & 0b111;
        var rem = data;
        for (var i = 0; i < 10; i++)
        {
            rem = (rem << 1) ^ ((rem >> 9) * 0x537);
        }

        var bits = ((data << 10) | rem) ^ 0x5412;

        // First copy around top-left finder
        for (var i = 0; i <= 5; i++)
        {
            SetFunctionModule(i, 8, GetBit(bits, i), modules, isFunction);
        }

        SetFunctionModule(7, 8, GetBit(bits, 6), modules, isFunction);
        SetFunctionModule(8, 8, GetBit(bits, 7), modules, isFunction);
        SetFunctionModule(8, 7, GetBit(bits, 8), modules, isFunction);
        for (var i = 9; i < 15; i++)
        {
            SetFunctionModule(8, 14 - i, GetBit(bits, i), modules, isFunction);
        }

        // Second copy split across top-right and bottom-left
        for (var i = 0; i < 8; i++)
        {
            SetFunctionModule(8, size - 1 - i, GetBit(bits, i), modules, isFunction);
        }

        for (var i = 8; i < 15; i++)
        {
            SetFunctionModule(size - 15 + i, 8, GetBit(bits, i), modules, isFunction);
        }

        // Fixed dark module
        SetFunctionModule(size - 8, 8, true, modules, isFunction);
    }

    private static void DrawCodewords(byte[] codewords, int size, bool[,] modules, bool[,] isFunction)
    {
        var bitIdx = 0;
        var totalBits = codewords.Length * 8;

        for (var right = size - 1; right >= 1; right -= 2)
        {
            if (right == 6)
            {
                right = 5;
            }

            var upward = ((right + 1) & 2) == 0;
            for (var vert = 0; vert < size; vert++)
            {
                var r = upward ? size - 1 - vert : vert;
                for (var j = 0; j < 2; j++)
                {
                    var c = right - j;
                    if (!isFunction[r, c])
                    {
                        var dark = false;
                        if (bitIdx < totalBits)
                        {
                            dark = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) != 0;
                            bitIdx++;
                        }

                        modules[r, c] = dark;
                    }
                }
            }
        }
    }

    private static void ApplyMask(int mask, int size, bool[,] modules, bool[,] isFunction)
    {
        for (var r = 0; r < size; r++)
        {
            for (var c = 0; c < size; c++)
            {
                if (isFunction[r, c])
                {
                    continue;
                }

                var invert = mask switch
                {
                    0 => ((r + c) & 1) == 0,
                    1 => (r & 1) == 0,
                    2 => c % 3 == 0,
                    3 => (r + c) % 3 == 0,
                    4 => ((r / 2) + (c / 3)) % 2 == 0,
                    5 => ((r * c) % 2) + ((r * c) % 3) == 0,
                    6 => (((r * c) % 2) + ((r * c) % 3)) % 2 == 0,
                    _ => (((r + c) % 2) + ((r * c) % 3)) % 2 == 0,
                };
                if (invert)
                {
                    modules[r, c] = !modules[r, c];
                }
            }
        }
    }

    private static int ComputePenaltyScore(int size, bool[,] modules)
    {
        var score = 0;

        // Rule 1: Runs of >=5 same-color modules in rows and columns
        for (var r = 0; r < size; r++)
        {
            var runColor = modules[r, 0];
            var runLen = 1;
            for (var c = 1; c < size; c++)
            {
                if (modules[r, c] == runColor)
                {
                    runLen++;
                    if (runLen == 5)
                    {
                        score += 3;
                    }
                    else if (runLen > 5)
                    {
                        score++;
                    }
                }
                else
                {
                    runColor = modules[r, c];
                    runLen = 1;
                }
            }
        }

        for (var c = 0; c < size; c++)
        {
            var runColor = modules[0, c];
            var runLen = 1;
            for (var r = 1; r < size; r++)
            {
                if (modules[r, c] == runColor)
                {
                    runLen++;
                    if (runLen == 5)
                    {
                        score += 3;
                    }
                    else if (runLen > 5)
                    {
                        score++;
                    }
                }
                else
                {
                    runColor = modules[r, c];
                    runLen = 1;
                }
            }
        }

        // Rule 2: 2x2 same-color blocks
        for (var r = 0; r < size - 1; r++)
        {
            for (var c = 0; c < size - 1; c++)
            {
                var color = modules[r, c];
                if (color == modules[r, c + 1] && color == modules[r + 1, c] && color == modules[r + 1, c + 1])
                {
                    score += 3;
                }
            }
        }

        // Rule 3: Finder-like 1:1:3:1:1 patterns with 4 light modules on either side
        for (var r = 0; r < size; r++)
        {
            var bits = 0;
            for (var c = 0; c < size; c++)
            {
                bits = ((bits << 1) & 0x7FF) | (modules[r, c] ? 1 : 0);
                if (c >= 10 && (bits == 0b10111010000 || bits == 0b00001011101))
                {
                    score += 40;
                }
            }
        }

        for (var c = 0; c < size; c++)
        {
            var bits = 0;
            for (var r = 0; r < size; r++)
            {
                bits = ((bits << 1) & 0x7FF) | (modules[r, c] ? 1 : 0);
                if (r >= 10 && (bits == 0b10111010000 || bits == 0b00001011101))
                {
                    score += 40;
                }
            }
        }

        // Rule 4: Dark/light balance
        var darkCount = 0;
        for (var r = 0; r < size; r++)
        {
            for (var c = 0; c < size; c++)
            {
                if (modules[r, c])
                {
                    darkCount++;
                }
            }
        }

        var total = size * size;
        var k = ((Math.Abs((darkCount * 20) - (total * 10)) + total - 1) / total) - 1;
        if (k > 0)
        {
            score += k * 10;
        }

        return score;
    }

    private static int[] GetAlignmentPatternPositions(int version, int size)
    {
        if (version == 1)
        {
            return Array.Empty<int>();
        }

        var numAlign = (version / 7) + 2;
        var step = (((version * 4) + (numAlign * 2) + 1) / ((numAlign * 2) - 2)) * 2;
        var res = new int[numAlign];
        res[0] = 6;
        var pos = size - 7;
        for (var i = numAlign - 1; i >= 1; i--)
        {
            res[i] = pos;
            pos -= step;
        }

        return res;
    }

    private static void SetFunctionModule(int r, int c, bool dark, bool[,] modules, bool[,] isFunction)
    {
        modules[r, c] = dark;
        isFunction[r, c] = true;
    }

    private static bool GetBit(int x, int i) => ((x >> i) & 1) != 0;

    private static void AppendBits(int val, int len, List<bool> bits)
    {
        for (var i = len - 1; i >= 0; i--)
        {
            bits.Add(((val >> i) & 1) != 0);
        }
    }

    private static byte[] BuildReedSolomonDivisor(int degree)
    {
        var result = new byte[degree];
        result[degree - 1] = 1;
        byte root = 1;
        for (var i = 0; i < degree; i++)
        {
            for (var j = 0; j < degree; j++)
            {
                result[j] = GfMultiply(result[j], root);
                if (j + 1 < degree)
                {
                    result[j] ^= result[j + 1];
                }
            }

            root = GfMultiply(root, 0x02);
        }

        return result;
    }

    private static byte[] ComputeReedSolomonRemainder(byte[] data, byte[] divisor)
    {
        var result = new byte[divisor.Length];
        foreach (var b in data)
        {
            var factor = (byte)(b ^ result[0]);
            Buffer.BlockCopy(result, 1, result, 0, result.Length - 1);
            result[^1] = 0;
            for (var i = 0; i < result.Length; i++)
            {
                result[i] ^= GfMultiply(divisor[i], factor);
            }
        }

        return result;
    }

    private static byte GfMultiply(byte x, byte y)
    {
        var z = 0;
        for (var i = 7; i >= 0; i--)
        {
            z = (z << 1) ^ ((z >> 7) * 0x11D);
            z ^= ((y >> i) & 1) * x;
        }

        return (byte)z;
    }
}
