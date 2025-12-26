
export async function main({ viewer }){
    
    window.viewer = viewer; // for easy debugging
    
    // viewer is the ThreeViewer instance
    // go wild.
  
    // objects in the scene file are loaded under the model root  
    console.log('[kite]: Model Root', viewer.scene.modelRoot);
    
}

export async function onError(err){

    // Oops something went wrong during setup or loading the main scene.
    
    console.error('[kite]: Error during setup', err)

}
