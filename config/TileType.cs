using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public enum TileType
{
    None = 0,
    
    //Grassland
    Plain = 1, 
    Wood = 2, 
    Forest = 3, 
    Hill = 4,
    Mountain = 5, 
    Shallow = 6, 
    DeepWater = 7, 
    Fortress = 8,
    
    //Desert
    Sand = 11,
    Dune = 12, //Range++
    DesertMountain = 13, //
    Oasis = 14, //Dodge++, Recover Health
    DesertRiver = 15, //Cost++
    SandStorm = 16, //Dodge++, Hit--
    Pyramid = 17,  //MAG++
    DesertFortress = 18, //DEF++
}
